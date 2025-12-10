const User = require("../models/User");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const StripeCustomer = require("../models/StripeCustomer");
const StripeSubscription = require("../models/StripeSubscription");
const System = require("../models/System");

// Initialize Stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "365d" });
};

// @desc    Get all users
// @route   GET /api/users
// @access  Public
const getUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json({
      success: true,
      count: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Public
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Create new user
// @route   POST /api/users
// @access  Public
const createUser = async (req, res) => {
  try {
    const existingUser = await User.findOne({
      email: req.body.email.toLowerCase().trim(),
    });
    if (existingUser) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const user = new User({
      email: req.body.email.toLowerCase().trim(),
      password: req.body.password,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      role: "user",
    });
    await user.save();

    res.status(201).json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Email already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.isBlocked) {
      return res.status(403).json({ message: "Account is blocked" });
    }
    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("error in exports.login ", error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Public
const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "Email already exists",
      });
    }

    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Public
const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// @desc Register and Subscribe
// @route   POST /api/users/register-and-subscribe
// @access  Public
const registerAndSubscribe = async (req, res) => {
  const { email, password, firstName, lastName, productId, systemSlugs } =
    req.body;
  console.log("req.body", req.body);

  if (!productId) {
    return res.status(400).json({ message: "Product ID is required." });
  }

  try {
    // 1. Check if user already exists
    const existingUser = await User.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingUser) {
      return res.status(409).json({ message: "Email already registered." });
    }

    // 2. Create a new Stripe Customer
    const stripeCustomer = await stripe.customers.create({
      email: email.toLowerCase().trim(),
      name: `${firstName} ${lastName}`,
    });

    // 3. Create a new User in your database
    const user = new User({
      email: email.toLowerCase().trim(),
      password, // Password will be hashed by the 'pre-save' middleware
      firstName,
      lastName,
      role: "user",
    });
    console.log("user", user);
    await user.save();

    // 4. Link the Stripe customer to the user in your database
    const customerMapping = new StripeCustomer({
      userId: user._id,
      stripeCustomerId: stripeCustomer.id,
    });
    console.log("customerMapping", customerMapping);
    await customerMapping.save();

    // 5. Find the active price for the given product ID
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1,
    });
    console.log("prices", prices);

    if (prices.data.length === 0) {
      return res
        .status(400)
        .json({ message: "No active price found for the given product." });
    }
    const priceId = prices.data[0].id;

    // 6. Create a Stripe Checkout Session for the subscription
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancelled`,
      // Pass the userId in metadata to use it in webhooks
      subscription_data: {
        metadata: {
          userId: user._id.toString(),
          productId: productId,
          systemSlugs: JSON.stringify(systemSlugs),
        },
      },
    });
    console.log("session", session);

    // 7. Return the session URL to the frontend
    res.json({ url: session.url });
  } catch (error) {
    console.error("Error in registerAndSubscribe:", error);
    res
      .status(500)
      .json({ message: "An error occurred during the signup process." });
  }
};

// @desc    Get billing details
// @route   GET /api/users/billing
// @access  Private

const getBillingDetails = async (req, res) => {
  try {
    const userId = req.user.id; // From your auth middleware

    // 1. Get user's subscription from DB
    const subscription = await StripeSubscription.findOne({
      userId,
      status: { $in: ["active", "trialing", "past_due"] }, // Active subscriptions
    }).sort({ createdAt: -1 }); // Get most recent

    if (!subscription) {
      return res.json({
        hasSubscription: false,
        currentPlan: null,
        paymentMethod: null,
        billingHistory: [],
      });
    }

    // 2. Get Stripe customer
    const stripeCustomer = await StripeCustomer.findOne({ userId });

    // Get subscription details from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    );

    // Update database subscription with latest period dates from Stripe if available
    if (
      stripeSubscription.current_period_start ||
      stripeSubscription.current_period_end
    ) {
      const updateData = {};
      if (stripeSubscription.current_period_start) {
        updateData.currentPeriodStart = new Date(
          stripeSubscription.current_period_start * 1000
        );
      }
      if (stripeSubscription.current_period_end) {
        updateData.currentPeriodEnd = new Date(
          stripeSubscription.current_period_end * 1000
        );
      }
      await StripeSubscription.findByIdAndUpdate(subscription._id, updateData);
    }

    // Get price and product details
    const price = await stripe.prices.retrieve(
      stripeSubscription.items.data[0].price.id
    );
    const product = await stripe.products.retrieve(price.product);

    // Get next billing date - only if NOT cancelling
    // If cancelling, don't show next billing date (frontend will show cancellation date instead)
    let nextBillingDate = null;
    if (!subscription.cancelAtPeriodEnd) {
      if (stripeSubscription.current_period_end) {
        // Stripe returns Unix timestamp in seconds, convert to milliseconds for Date
        nextBillingDate = new Date(
          stripeSubscription.current_period_end * 1000
        );
      } else {
        // Fallback to database value if Stripe doesn't have it
        const updatedSubscription = await StripeSubscription.findById(
          subscription._id
        );
        if (updatedSubscription?.currentPeriodEnd) {
          nextBillingDate = updatedSubscription.currentPeriodEnd;
        }
      }
    }

    // Get payment method
    let paymentMethod = null;
    if (stripeCustomer?.defaultPaymentMethodId) {
      const pm = await stripe.paymentMethods.retrieve(
        stripeCustomer.defaultPaymentMethodId
      );
      paymentMethod = {
        type: pm.card?.brand || "card",
        last4: pm.card?.last4 || "",
        expMonth: pm.card?.exp_month || "",
        expYear: pm.card?.exp_year || "",
      };
    } else if (stripeSubscription.default_payment_method) {
      const pm = await stripe.paymentMethods.retrieve(
        stripeSubscription.default_payment_method
      );
      paymentMethod = {
        type: pm.card?.brand || "card",
        last4: pm.card?.last4 || "",
        expMonth: pm.card?.exp_month || "",
        expYear: pm.card?.exp_year || "",
      };
    }

    // Get invoice history
    const invoices = await stripe.invoices.list({
      customer: stripeCustomer.stripeCustomerId,
      limit: 12, // Last 12 invoices
      status: "paid",
    });

    // Get systems for plan description
    const systems = await System.find({ isActive: true });

    // Format response
    const response = {
      hasSubscription: true,
      currentPlan: {
        name: product.name || subscription.plan,
        status: subscription.status,
        description: getPlanDescription(subscription, systems),
        price: (price.unit_amount / 100).toFixed(2),
        currency: price.currency.toUpperCase(),
        period: price.recurring?.interval || "month",
        nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null,
        productId: subscription.productId,
        priceId: price.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        // Add cancellation fields from database
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
        cancelAt: subscription.cancelAt
          ? subscription.cancelAt.toISOString()
          : null,
        canceledAt: subscription.canceledAt
          ? subscription.canceledAt.toISOString()
          : null,
      },
      paymentMethod: paymentMethod
        ? {
            brand: paymentMethod.type,
            last4: paymentMethod.last4,
            expMonth: paymentMethod.expMonth,
            expYear: paymentMethod.expYear,
          }
        : null,
      memberSince: subscription.createdAt || new Date(),
      billingHistory: invoices.data.map((invoice) => ({
        id: invoice.id,
        date: new Date(invoice.created * 1000),
        description: invoice.lines.data[0]?.description || product.name,
        amount: (invoice.amount_paid / 100).toFixed(2),
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        invoiceUrl: invoice.invoice_pdf || invoice.hosted_invoice_url,
      })),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching billing data:", error);
    res.status(500).json({ message: "Failed to fetch billing data" });
  }
};
// Helper function
function getPlanDescription(subscription, systems) {
  // Check metadata for system slugs
  const systemSlugs = subscription.metadata?.systemSlugs
    ? JSON.parse(subscription.metadata.systemSlugs)
    : [];

  if (systemSlugs.length === systems.length) {
    return `Access to all ${systems.length} trading systems`;
  } else if (systemSlugs.length === 1) {
    const system = systems.find((s) => s.slug === systemSlugs[0]);
    return `Access to ${system?.name || "1 system"}`;
  } else {
    return `Access to ${systemSlugs.length} systems`;
  }
}

// @desc    Cancel subscription
// @route   POST /api/users/cancel-subscription
// @access  Private
const cancelSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId } = req.body;
    const userId = req.user.id;

    if (!stripeSubscriptionId) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    // Verify the subscription belongs to this user
    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Check if already cancelled
    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message: "Subscription is already scheduled for cancellation",
      });
    }

    // Cancel subscription in Stripe (at period end)
    const canceledSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      }
    );

    // Update subscription in database immediately
    // (Webhook will also update these, but we update now for immediate UI feedback)
    subscription.cancelAtPeriodEnd = true;
    subscription.canceledAt = canceledSubscription.canceled_at
      ? new Date(canceledSubscription.canceled_at * 1000)
      : new Date();
    subscription.cancelAt = canceledSubscription.cancel_at
      ? new Date(canceledSubscription.cancel_at * 1000)
      : canceledSubscription.current_period_end
      ? new Date(canceledSubscription.current_period_end * 1000)
      : null;
    subscription.status = canceledSubscription.status; // Still 'active' but will be updated by webhook
    await subscription.save();

    res.json({
      success: true,
      message:
        "Subscription will be cancelled at the end of the billing period",
      cancelAt: canceledSubscription.cancel_at
        ? new Date(canceledSubscription.cancel_at * 1000).toISOString()
        : canceledSubscription.current_period_end
        ? new Date(canceledSubscription.current_period_end * 1000).toISOString()
        : null,
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ message: "Failed to cancel subscription" });
  }
};

// @desc    Resume subscription
// @route   POST /api/users/resume-subscription
// @access  Private
const resumeSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId } = req.body;
    const userId = req.user.id;

    if (!stripeSubscriptionId) {
      return res.status(400).json({ message: "Subscription ID is required" });
    }

    // Verify the subscription belongs to this user
    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Check if subscription is actually scheduled for cancellation
    if (!subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message: "Subscription is not scheduled for cancellation",
      });
    }

    // Resume subscription in Stripe
    const resumedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        cancel_at_period_end: false,
      }
    );
    console.log("resumedSubscription", resumedSubscription);
    // Update subscription in database immediately
    subscription.cancelAtPeriodEnd = false;
    subscription.cancelAt = null;
    // Keep canceledAt for historical record, but clear cancelAt
    subscription.status = resumedSubscription.status;
    await subscription.save();

    console.log("subscription", subscription);

    res.json({
      success: true,
      message: "Subscription resumed successfully",
    });
  } catch (error) {
    console.error("Error resuming subscription:", error);
    res.status(500).json({ message: "Failed to resume subscription" });
  }
};

// @desc    Create Stripe Customer Portal session
// @route   POST /api/users/create-portal-session
// @access  Private

const createPortalSession = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get Stripe customer
    const stripeCustomer = await StripeCustomer.findOne({ userId });

    if (!stripeCustomer) {
      return res.status(404).json({ message: "No Stripe customer found" });
    }

    // Create Stripe Customer Portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomer.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/dashboard/billings`,
    });

    res.json({
      url: portalSession.url,
    });
  } catch (error) {
    console.error("Error creating portal session:", error);
    res.status(500).json({ message: "Failed to create portal session" });
  }
};

// @desc    Change subscription (upgrade/downgrade)
// @route   POST /api/users/change-subscription
// @access  Private

const changeSubscription = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, newPriceId, systemSlugs } =
      req.body;
    const userId = req.user.id;

    if (!stripeSubscriptionId || !newProductId || !newPriceId) {
      return res.status(400).json({
        message: "Subscription ID, product ID, and price ID are required",
      });
    }

    // Verify the subscription belongs to this user
    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Check if subscription is cancelled
    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Determine if this is an upgrade or downgrade
    const currentProductId = subscription.productId;
    const isUpgrade =
      newProductId === "prod_TZZdcgHBZ13uZ9" || // All Systems Yearly
      (newProductId === "prod_TZZcEMlv2cNNWl" && // All Systems Monthly
        [
          "prod_TZZbjLqthXdjxx",
          "prod_TZZcUfjAmtJfkg",
          "prod_TZZcuPVww3QyDm",
        ].includes(currentProductId)); // From Single System

    // Get current subscription from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    // Update the subscription item with new price
    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [
        {
          id: stripeSubscription.items.data[0].id, // Current subscription item ID
          price: newPriceId, // New price ID
        },
      ],
      // Proration behavior: create_prorations for upgrades, none for downgrades
      proration_behavior: isUpgrade ? "create_prorations" : "none",
      // For downgrades, schedule for period end. For upgrades, immediate.
      billing_cycle_anchor: isUpgrade ? "now" : "unchanged",
      metadata: {
        userId: userId.toString(),
        productId: newProductId,
        systemSlugs: JSON.stringify(systemSlugs || []),
      },
    });

    // Retrieve the updated subscription to get the current period dates
    const updatedSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    // Validate and convert dates from Stripe response
    // Note: current_period_start and current_period_end should be present after retrieval
    const currentPeriodStart =
      updatedSubscription.current_period_start &&
      typeof updatedSubscription.current_period_start === "number"
        ? new Date(updatedSubscription.current_period_start * 1000)
        : null;

    const currentPeriodEnd =
      updatedSubscription.current_period_end &&
      typeof updatedSubscription.current_period_end === "number"
        ? new Date(updatedSubscription.current_period_end * 1000)
        : null;

    // If dates are still not available, calculate from billing_cycle_anchor and plan interval
    let finalPeriodStart = currentPeriodStart;
    let finalPeriodEnd = currentPeriodEnd;

    if (!finalPeriodStart || isNaN(finalPeriodStart.getTime())) {
      // Fallback: use billing_cycle_anchor
      if (
        updatedSubscription.billing_cycle_anchor &&
        typeof updatedSubscription.billing_cycle_anchor === "number"
      ) {
        finalPeriodStart = new Date(
          updatedSubscription.billing_cycle_anchor * 1000
        );
      } else {
        // Last resort: use current date
        finalPeriodStart = new Date();
      }
    }

    if (!finalPeriodEnd || isNaN(finalPeriodEnd.getTime())) {
      // Calculate period end based on plan interval
      const plan = updatedSubscription.items.data[0]?.price;
      if (plan && finalPeriodStart) {
        const interval = plan.interval; // 'month' or 'year'
        const intervalCount = plan.interval_count || 1;

        finalPeriodEnd = new Date(finalPeriodStart);
        if (interval === "month") {
          finalPeriodEnd.setMonth(finalPeriodEnd.getMonth() + intervalCount);
        } else if (interval === "year") {
          finalPeriodEnd.setFullYear(
            finalPeriodEnd.getFullYear() + intervalCount
          );
        } else if (interval === "day") {
          finalPeriodEnd.setDate(finalPeriodEnd.getDate() + intervalCount);
        } else if (interval === "week") {
          finalPeriodEnd.setDate(finalPeriodEnd.getDate() + intervalCount * 7);
        }
      } else {
        // Last resort: use current date + 1 month
        finalPeriodEnd = new Date(finalPeriodStart || new Date());
        finalPeriodEnd.setMonth(finalPeriodEnd.getMonth() + 1);
      }
    }

    // Final validation
    if (!finalPeriodStart || isNaN(finalPeriodStart.getTime())) {
      console.error("Could not determine valid currentPeriodStart");
      return res.status(500).json({
        message: "Failed to update subscription: invalid period start date",
      });
    }

    if (!finalPeriodEnd || isNaN(finalPeriodEnd.getTime())) {
      console.error("Could not determine valid currentPeriodEnd");
      return res.status(500).json({
        message: "Failed to update subscription: invalid period end date",
      });
    }

    // Update subscription in database
    subscription.productId = newProductId;
    subscription.plan = newPriceId; // Store price ID as plan
    subscription.status = updatedSubscription.status;
    subscription.currentPeriodStart = finalPeriodStart;
    subscription.currentPeriodEnd = finalPeriodEnd;

    // Clear cancellation fields if upgrading (since upgrade is immediate)
    if (isUpgrade) {
      subscription.cancelAtPeriodEnd = false;
      subscription.cancelAt = null;
      subscription.canceledAt = null;
    }

    // Update metadata with new system slugs
    subscription.metadata = {
      ...subscription.metadata,
      productId: newProductId,
      systemSlugs: JSON.stringify(systemSlugs || []),
    };

    await subscription.save();

    res.json({
      success: true,
      message: isUpgrade
        ? "Subscription upgraded successfully"
        : "Subscription change scheduled successfully",
      effectiveDate: isUpgrade
        ? new Date().toISOString()
        : finalPeriodEnd.toISOString(),
    });
  } catch (error) {
    console.error("Error changing subscription:", error);
    res.status(500).json({
      message: error.message || "Failed to change subscription",
    });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "firstName lastName email"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Failed to fetch user profile" });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    // Validate required fields
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    // Check if email is already taken by another user
    const existingUser = await User.findOne({
      email: email.toLowerCase().trim(),
      _id: { $ne: req.user.id },
    });
    if (existingUser) {
      return res.status(400).json({ message: "Email is already in use" });
    }
    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        firstName: firstName?.trim() || "",
        lastName: lastName?.trim() || "",
        email: email.toLowerCase().trim(),
      },
      { new: true, runValidators: true }
    ).select("firstName lastName email");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      message: "Profile updated successfully",
      user: {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

// @desc    Get user email preferences
// @route   GET /api/users/email-preferences
// @access  Private
const getEmailPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("emailPreferences");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      emailPreferences: user.emailPreferences || {
        dailySelections: true,
        resultsUpdates: true,
        monthlyPerformanceReport: true,
        systemUpdates: true,
        billingReminders: true,
        marketingEmails: true,
      },
    });
  } catch (error) {
    console.error("Error fetching email preferences:", error);
    res.status(500).json({ message: "Failed to fetch email preferences" });
  }
};

// @desc    Update user email preferences
// @route   PUT /api/users/email-preferences
// @access  Private
const updateEmailPreferences = async (req, res) => {
  try {
    const { emailPreferences } = req.body;

    if (!emailPreferences || typeof emailPreferences !== "object") {
      return res.status(400).json({
        message: "Email preferences object is required",
      });
    }

    // Validate all preference fields are booleans
    const validPreferences = {
      dailySelections:
        typeof emailPreferences.dailySelections === "boolean"
          ? emailPreferences.dailySelections
          : true,
      resultsUpdates:
        typeof emailPreferences.resultsUpdates === "boolean"
          ? emailPreferences.resultsUpdates
          : true,
      monthlyPerformanceReport:
        typeof emailPreferences.monthlyPerformanceReport === "boolean"
          ? emailPreferences.monthlyPerformanceReport
          : true,
      systemUpdates:
        typeof emailPreferences.systemUpdates === "boolean"
          ? emailPreferences.systemUpdates
          : true,
      billingReminders:
        typeof emailPreferences.billingReminders === "boolean"
          ? emailPreferences.billingReminders
          : true,
      marketingEmails:
        typeof emailPreferences.marketingEmails === "boolean"
          ? emailPreferences.marketingEmails
          : true,
    };

    // Update user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { emailPreferences: validPreferences },
      { new: true, runValidators: true }
    ).select("emailPreferences");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Email preferences updated successfully",
      emailPreferences: user.emailPreferences,
    });
  } catch (error) {
    console.error("Error updating email preferences:", error);
    res.status(500).json({ message: "Failed to update email preferences" });
  }
};

// @desc    Change user password
// @route   PUT /api/users/change-password
// @access  Private
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    // Validate new password length
    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters long",
      });
    }

    // Get user with password
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    // Check if new password is different from current password
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        message: "New password must be different from current password",
      });
    }

    // Update password (pre-save hook will hash it automatically)
    user.password = newPassword;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Failed to change password" });
  }
};

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
  registerAndSubscribe,
  getBillingDetails,
  cancelSubscription,
  resumeSubscription,
  createPortalSession,
  changeSubscription,
  getUserProfile,
  updateUserProfile,
  getEmailPreferences,
  updateEmailPreferences,
  changePassword,
};
