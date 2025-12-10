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

    // Get next billing date - use Stripe API value (most accurate), fallback to database value
    let nextBillingDate = null;
    if (stripeSubscription.current_period_end) {
      // Stripe returns Unix timestamp in seconds, convert to milliseconds for Date
      nextBillingDate = new Date(stripeSubscription.current_period_end * 1000);
    } else {
      // Fallback to database value if Stripe doesn't have it (shouldn't happen for active subscriptions)
      const updatedSubscription = await StripeSubscription.findById(
        subscription._id
      );
      if (updatedSubscription?.currentPeriodEnd) {
        nextBillingDate = updatedSubscription.currentPeriodEnd;
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
        nextBillingDate: nextBillingDate,
        productId: subscription.productId,
        priceId: price.id,
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

module.exports = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
  registerAndSubscribe,
  getBillingDetails,
};
