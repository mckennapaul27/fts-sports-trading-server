const User = require("../models/User");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const StripeCustomer = require("../models/StripeCustomer");
const StripeSubscription = require("../models/StripeSubscription");
const System = require("../models/System");
const { Resend } = require("resend");
const brevo = require("@getbrevo/brevo");

const getBrevoApiInstance = () => {
  const apiInstance = new brevo.ContactsApi();
  apiInstance.setApiKey(
    brevo.ContactsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
  );
  return apiInstance;
};

const getContactInfo = async (email) => {
  try {
    const apiInstance = getBrevoApiInstance();
    const identifier = email;
    const res = await apiInstance.getContactInfo(identifier);
    return res;
  } catch (error) {
    if (error.statusCode === 404 || error.response?.status === 404) {
      console.log("Contact with email ", email, "not found");
      return false;
    } else {
      console.log("Other error calling getContactInfo()", error);
      throw error;
    }
  }
};

const addContactToList = async (listId, emails) => {
  try {
    const apiInstance = getBrevoApiInstance();
    const contactEmails = new brevo.AddContactToList();
    contactEmails.emails = emails;

    const res = await apiInstance.addContactToList(listId, contactEmails);
    return res;
  } catch (error) {
    console.log("addContactToList error statusCode", error.statusCode);
    console.log("addContactToList error body", error.body);
    throw error;
  }
};

const updateContactAttributes = async (email, attributes) => {
  try {
    const apiInstance = getBrevoApiInstance();
    const updateContact = new brevo.UpdateContact();
    updateContact.attributes = attributes;

    const res = await apiInstance.updateContact(email, updateContact);
    return res;
  } catch (error) {
    console.log("updateContactAttributes error", error);
    throw error;
  }
};

const createBrevoContact = async (email, attributes = {}, listIds = []) => {
  const apiInstance = getBrevoApiInstance();

  const createContact = new brevo.CreateContact();
  createContact.email = email;
  createContact.attributes = attributes;
  createContact.listIds = listIds;

  try {
    const data = await apiInstance.createContact(createContact);
    console.log(
      "Brevo contact created successfully. Returned data: ",
      JSON.stringify(data)
    );
    return data;
  } catch (error) {
    const errorMessage = error.response ? error.response.text : error.message;
    console.error("Error creating Brevo contact:", errorMessage);
    console.log("error object", error);

    try {
      await resend.emails.send({
        from: "Fortis Sports Trading <noreply@mail.fortissportstrading.com>",
        to: "mckennapaul27@gmail.com",
        subject: "Error in createBrevoContact",
        html: `
          <h1>Error occurred in createBrevoContact</h1>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Error Message:</strong></p>
          <pre>${errorMessage}</pre>
          <p><strong>Full Error:</strong></p>
          <pre>${JSON.stringify(error, null, 2)}</pre>
        `,
      });
      console.log(
        "Resend error notification sent successfully for createBrevoContact."
      );
    } catch (resendError) {
      console.error(
        "Failed to send Resend error notification for createBrevoContact:",
        resendError
      );
    }

    throw error;
  }
};

// Initialize Stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Promotion configuration
const ALL_SYSTEMS_YEARLY_PRODUCT_IDS = {
  test: "prod_TZZdcgHBZ13uZ9",
  production: "prod_TePQBlRJx6Yfol",
};

const COUPON_IDS = {
  test: process.env.STRIPE_PROMOTION_COUPON_ID || "3PTHivK6", // Use env var if set, fallback to hardcoded
  production: process.env.STRIPE_PROMOTION_COUPON_ID || "", // Live coupon ID
};

/**
 * Check if promotion should be applied and return coupon ID if applicable
 * @param {string} productId - The Stripe product ID
 * @returns {string|null} - Coupon ID if promotion should be applied, null otherwise
 */
const getPromotionCouponId = (productId) => {
  const isProduction = process.env.NODE_ENV === "production";

  // Check if this is All Systems Yearly product
  const isAllSystemsYearly =
    productId === ALL_SYSTEMS_YEARLY_PRODUCT_IDS.test ||
    productId === ALL_SYSTEMS_YEARLY_PRODUCT_IDS.production;

  if (!isAllSystemsYearly) {
    return null;
  }

  // Check if promotion is active
  // For testing: Set to a wide date range that includes current date
  // For production: Update to actual promotion dates (e.g., 2026-01-01 to 2026-01-31)
  const now = new Date();

  // Testing dates (allows testing now - adjust as needed):
  const promotionStart = new Date("2024-01-01T00:00:00Z"); // Start from past date for testing
  const promotionEnd = new Date("2026-12-31T23:59:59Z"); // End in future for testing

  // Production dates (uncomment when ready for production):
  // const promotionStart = new Date("2026-01-01T00:00:00Z");
  // const promotionEnd = new Date("2026-01-31T23:59:59Z");

  const isPromotionActive = now >= promotionStart && now <= promotionEnd;

  if (!isPromotionActive) {
    return null;
  }

  // Get the appropriate coupon ID for current environment
  const couponId = isProduction ? COUPON_IDS.production : COUPON_IDS.test;

  // Only return coupon ID if it's configured (important for production before coupon is created)
  if (!couponId) {
    console.log(
      "[PROMOTION] Promotion is active but coupon ID not configured for production"
    );
    return null;
  }

  console.log(
    `[PROMOTION] Applying coupon ${couponId} to product ${productId}`
  );
  return couponId;
};

/**
 * Get promotion information for a product (for frontend display)
 * @param {string} productId - The Stripe product ID
 * @returns {object|null} - Promotion info with discount percentage and active status, or null
 */
const getPromotionInfo = (productId) => {
  const isAllSystemsYearly =
    productId === ALL_SYSTEMS_YEARLY_PRODUCT_IDS.test ||
    productId === ALL_SYSTEMS_YEARLY_PRODUCT_IDS.production;

  if (!isAllSystemsYearly) {
    return null;
  }

  const now = new Date();
  const promotionStart = new Date("2024-01-01T00:00:00Z");
  const promotionEnd = new Date("2026-12-31T23:59:59Z");

  const isPromotionActive = now >= promotionStart && now <= promotionEnd;

  if (!isPromotionActive) {
    return null;
  }

  // Return promotion info (50% discount based on your coupon)
  return {
    isActive: true,
    discountPercent: 50,
    validFrom: promotionStart.toISOString(),
    validTo: promotionEnd.toISOString(),
  };
};

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

    // Add contact to Brevo
    try {
      await createBrevoContact(
        req.body.email.toLowerCase().trim(),
        {
          FIRSTNAME: req.body.firstName || "",
          LASTNAME: req.body.lastName || "",
        },
        [4] // Add to list 4
      );
    } catch (brevoError) {
      // Log error but don't fail the user creation process
      console.error("Failed to add contact to Brevo:", brevoError);
    }

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
  // console.log("req.body", req.body);

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
    // console.log("user", user);
    await user.save();

    // 3.5. Add contact to Brevo
    try {
      await createBrevoContact(
        email.toLowerCase().trim(),
        {
          FIRSTNAME: firstName || "",
          LASTNAME: lastName || "",
        },
        [4] // Add to list 4
      );
    } catch (brevoError) {
      // Log error but don't fail the signup process
      console.error("Failed to add contact to Brevo:", brevoError);
    }

    // 4. Link the Stripe customer to the user in your database
    const customerMapping = new StripeCustomer({
      userId: user._id,
      stripeCustomerId: stripeCustomer.id,
    });
    // console.log("customerMapping", customerMapping);
    await customerMapping.save();

    // 5. Find the active price for the given product ID
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1,
    });
    // console.log("prices", prices);

    if (prices.data.length === 0) {
      return res
        .status(400)
        .json({ message: "No active price found for the given product." });
    }
    const priceId = prices.data[0].id;

    // 5.5. Check if promotion should be applied
    const couponId = getPromotionCouponId(productId);

    // 6. Create a Stripe Checkout Session for the subscription
    const sessionParams = {
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
    };

    // Apply coupon if promotion is active
    if (couponId) {
      sessionParams.discounts = [{ coupon: couponId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    // console.log("session", session);

    // 7. Return the session URL to the frontend
    res.json({ url: session.url });
  } catch (error) {
    console.error("Error in registerAndSubscribe:", error);
    res
      .status(500)
      .json({ message: "An error occurred during the signup process." });
  }
};

// @desc Exsiting User Subscribe
// @route   POST /api/users/existing-user-subscribe
// @access  Private
const existingUserSubscribe = async (req, res) => {
  const { productId, systemSlugs } = req.body;
  // console.log("req.body", req.body);
  const userId = req.user.id;
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  if (!productId) {
    return res.status(400).json({ message: "Product ID is required." });
  }

  try {
    let stripeCustomerId;
    // 1. Check if user already has a Stripe Customer
    const existingStripeCustomer = await StripeCustomer.findOne({ userId });
    if (existingStripeCustomer) {
      // Use the existing Stripe customer ID from the database
      stripeCustomerId = existingStripeCustomer.stripeCustomerId;
    } else {
      // Create a new Stripe Customer
      const stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      });
      stripeCustomerId = stripeCustomer.id;
      // Save the mapping to the database
      await StripeCustomer.create({
        userId,
        stripeCustomerId: stripeCustomer.id,
      });
    }

    // 5. Find the active price for the given product ID
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1,
    });
    // console.log("prices", prices);

    if (prices.data.length === 0) {
      return res
        .status(400)
        .json({ message: "No active price found for the given product." });
    }
    const priceId = prices.data[0].id;

    // 5.5. Check if promotion should be applied
    const couponId = getPromotionCouponId(productId);

    // 6. Create a Stripe Checkout Session for the subscription
    const sessionParams = {
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${process.env.FRONTEND_URL}/dashboard/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/dashboard/payment/cancelled`,
      // Pass the userId in metadata to use it in webhooks
      subscription_data: {
        metadata: {
          userId: user._id.toString(),
          productId: productId,
          systemSlugs: JSON.stringify(systemSlugs),
        },
      },
    };

    // Apply coupon if promotion is active
    if (couponId) {
      sessionParams.discounts = [{ coupon: couponId }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    // console.log("session", session);

    // 7. Return the session URL to the frontend
    res.json({ url: session.url });
  } catch (error) {
    console.error("Error in existingUserSubscribe:", error);
    res
      .status(500)
      .json({ message: "An error occurred during the subscription process." });
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
    // console.log("resumedSubscription", resumedSubscription);
    // Update subscription in database immediately
    subscription.cancelAtPeriodEnd = false;
    subscription.cancelAt = null;
    // Keep canceledAt for historical record, but clear cancelAt
    subscription.status = resumedSubscription.status;
    await subscription.save();

    // console.log("subscription", subscription);

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

    // Update user's activeSystemIds based on all active subscriptions
    // This ensures we aggregate all subscriptions if user has multiple
    // The webhook will also update this, but we update now for immediate effect
    try {
      const StripeSubscription = require("../models/StripeSubscription");
      const System = require("../models/System");

      // Find all active subscriptions for the user
      const activeSubscriptions = await StripeSubscription.find({
        userId,
        status: { $in: ["active", "trialing"] },
      });

      // Collect all system slugs from all active subscriptions
      const allSystemSlugs = new Set();
      for (const sub of activeSubscriptions) {
        if (sub.metadata && sub.metadata.systemSlugs) {
          try {
            const parsed = JSON.parse(sub.metadata.systemSlugs);
            if (Array.isArray(parsed)) {
              parsed.forEach((slug) => allSystemSlugs.add(slug));
            }
          } catch (e) {
            // If parsing fails, skip this subscription's systems
            console.error(
              `Error parsing systemSlugs for subscription ${sub.stripeSubscriptionId}:`,
              e
            );
          }
        }
      }

      // Look up all systems by their slugs
      const systems = await System.find({
        slug: { $in: Array.from(allSystemSlugs) },
      });

      // Update user's activeSystemIds
      const user = await User.findById(userId);
      if (user) {
        user.activeSystemIds = systems.map((system) => system._id);
        await user.save();
        console.log(
          `User ${userId} activeSystemIds updated in changeSubscription:`,
          user.activeSystemIds
        );
      }
    } catch (error) {
      console.error(
        "Error updating user activeSystemIds in changeSubscription:",
        error
      );
      // Don't fail the request if this fails, but log it
    }

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

// @desc    Forgot password - send reset token via email
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success message to prevent email enumeration
    // Don't reveal if email exists or not
    if (!user) {
      return res.json({
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

    // Save token and expiry to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(resetTokenExpiry);
    await user.save();

    // Create reset URL
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    // Send email via Resend
    try {
      await resend.emails.send({
        from: "Fortis Sports Trading <noreply@mail.fortissportstrading.com>",
        to: user.email,
        subject: "Password Reset Request",
        html: `
          <h1>Password Reset Request</h1>
          <p>Hi ${user.firstName || "there"},</p>
          <p>You requested to reset your password. Click the link below to reset it:</p>
          <p><a href="${resetUrl}" style="display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p>${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <p>Thanks,<br>Fortis Sports Trading</p>
        `,
      });

      res.json({
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    } catch (emailError) {
      console.error("Error sending reset email:", emailError);
      // Clear the token if email failed
      user.resetToken = null;
      user.resetTokenExpiry = null;
      await user.save();

      return res.status(500).json({
        message: "Failed to send reset email. Please try again later.",
      });
    }
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res
      .status(500)
      .json({ message: "Failed to process password reset request" });
  }
};

// @desc    Reset password using token
// @route   POST /api/users/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Validate required fields
    if (!token || !password) {
      return res.status(400).json({
        message: "Token and password are required",
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    // Find user with valid reset token
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }, // Token must not be expired
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired reset token",
      });
    }

    // Update password (pre-save hook will hash it automatically)
    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
};

// @desc    Subscribe to newsletter
// @route   POST /api/users/newsletter-subscribe
// @access  Public
const subscribeToNewsletter = async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;

    // Validate email
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    // Add contact to Brevo with list 5
    const normalizedEmail = email.toLowerCase().trim();
    const attributes = {
      FIRSTNAME: firstName || "",
      LASTNAME: lastName || "",
    };

    try {
      // Try to create the contact
      await createBrevoContact(normalizedEmail, attributes, [5]);
      res.json({
        success: true,
        message: "Successfully subscribed to newsletter",
      });
    } catch (brevoError) {
      // Check if error is due to duplicate contact
      const errorData = brevoError.response?.data || brevoError.body;
      const isDuplicateError =
        (brevoError.response?.status === 400 ||
          brevoError.statusCode === 400) &&
        (errorData?.code === "duplicate_parameter" ||
          errorData?.message?.includes("already associated") ||
          errorData?.message?.includes("email is already"));

      if (isDuplicateError) {
        try {
          // Contact already exists, just add them to list 5
          await addContactToList(5, [normalizedEmail]);

          // Optionally update attributes if provided
          if (firstName || lastName) {
            try {
              await updateContactAttributes(normalizedEmail, attributes);
            } catch (updateError) {
              // Log but don't fail - adding to list is the main goal
              console.log("Failed to update contact attributes:", updateError);
            }
          }

          res.json({
            success: true,
            message: "Successfully subscribed to newsletter",
          });
        } catch (addToListError) {
          console.error(
            "Failed to add existing contact to newsletter list:",
            addToListError
          );
          res.status(500).json({
            message:
              "Failed to subscribe to newsletter. Please try again later.",
          });
        }
      } else {
        // Some other error occurred
        console.error(
          "Failed to subscribe to newsletter in Brevo:",
          brevoError
        );
        res.status(500).json({
          message: "Failed to subscribe to newsletter. Please try again later.",
        });
      }
    }
  } catch (error) {
    console.error("Error in subscribeToNewsletter:", error);
    res
      .status(500)
      .json({ message: "Failed to process newsletter subscription" });
  }
};

// @desc    Get promotion info for a product (for frontend display)
// @route   GET /api/users/promotion/:productId
// @access  Public
const getPromotionInfoForProduct = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: "Product ID is required",
      });
    }

    const promotionInfo = getPromotionInfo(productId);

    if (!promotionInfo) {
      return res.status(200).json({
        success: true,
        data: {
          isActive: false,
          discountPercent: 0,
        },
      });
    }

    res.status(200).json({
      success: true,
      data: promotionInfo,
    });
  } catch (error) {
    console.error("Error fetching promotion info:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
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
  existingUserSubscribe,
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
  forgotPassword,
  resetPassword,
  subscribeToNewsletter,
  getPromotionInfoForProduct,
};
