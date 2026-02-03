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

  // Filter out empty string values from attributes (Brevo may reject empty strings)
  const cleanedAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined && value !== "") {
      cleanedAttributes[key] = value;
    }
  }

  const createContact = new brevo.CreateContact();
  createContact.email = email;
  createContact.attributes = cleanedAttributes;
  createContact.listIds = listIds;
  // Set updateEnabled to true to allow updating existing contacts instead of failing
  createContact.updateEnabled = true;

  // Log what we're sending to Brevo for debugging
  console.log("Creating Brevo contact:", {
    email,
    attributes: cleanedAttributes,
    listIds,
    updateEnabled: true,
  });

  try {
    const data = await apiInstance.createContact(createContact);
    console.log(
      "Brevo contact created successfully. Returned data: ",
      JSON.stringify(data)
    );
    return data;
  } catch (error) {
    // Extract error details from Brevo API response
    const errorData = error.response?.data || error.body || error.response?.text;
    const errorMessage = errorData?.message || error.message || "Unknown error";
    const errorCode = errorData?.code || error.statusCode || error.response?.status;
    
    // Log detailed error information
    console.error("Error creating Brevo contact:", {
      email,
      statusCode: errorCode,
      errorMessage,
      errorData: errorData ? JSON.stringify(errorData, null, 2) : "No error data",
      fullError: error.response ? JSON.stringify(error.response, null, 2) : "No response"
    });

    // Check if error is due to duplicate contact
    const isDuplicateError =
      errorCode === 400 &&
      (errorData?.code === "duplicate_parameter" ||
        errorData?.message?.includes("already associated") ||
        errorData?.message?.includes("email is already") ||
        errorData?.message?.includes("Contact already exist"));

    if (isDuplicateError) {
      console.log(`Contact with email ${email} already exists in Brevo`);
      // For duplicate contacts, try to add them to the requested lists instead
      if (listIds && listIds.length > 0) {
        try {
          await addContactToList(listIds[0], [email]);
          console.log(`Successfully added existing contact ${email} to list ${listIds[0]}`);
          // Return a success-like response since the contact exists and was added to list
          return { id: "existing", email };
        } catch (addToListError) {
          console.error("Failed to add existing contact to list:", addToListError);
          // Still throw the original error if adding to list fails
        }
      }
      // If no listIds provided or adding to list failed, throw the duplicate error
      throw new Error(`Contact with email ${email} already exists in Brevo`);
    }

    // Send error notification email with better error details
    try {
      await resend.emails.send({
        from: "Fortis Sports Trading <noreply@mail.fortissportstrading.com>",
        to: "mckennapaul27@gmail.com",
        subject: "Error in createBrevoContact",
        html: `
          <h1>Error occurred in createBrevoContact</h1>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Status Code:</strong> ${errorCode}</p>
          <p><strong>Error Message:</strong> ${errorMessage}</p>
          <p><strong>Error Data:</strong></p>
          <pre>${errorData ? JSON.stringify(errorData, null, 2) : "No error data"}</pre>
          <p><strong>Full Error Response:</strong></p>
          <pre>${error.response ? JSON.stringify(error.response, null, 2) : JSON.stringify(error, null, 2)}</pre>
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

// Product ID configuration (matches frontend config)
const PRODUCT_IDS = {
  test: {
    ALL_SYSTEMS_YEARLY: "prod_TuX5CZShsGjSV3",
    ALL_SYSTEMS_MONTHLY: "prod_TuWZ5QV2ICNGoZ",
    SINGLE_SYSTEM_1: "prod_TuWY39xLvpurco",
    SINGLE_SYSTEM_2: "prod_TuWYybtPZAmjk9",
    SINGLE_SYSTEM_3: "prod_TuWYZoWwjZiM5t",
    SINGLE_SYSTEM_4: "prod_TuWY4ULAcIrsHl",
  },
  production: {
    ALL_SYSTEMS_YEARLY: "prod_TePQBlRJx6Yfol",
    ALL_SYSTEMS_MONTHLY: "prod_TePPJPkddMweFM",
    SINGLE_SYSTEM_1: "prod_TePN1px9j4zOuA",
    SINGLE_SYSTEM_2: "prod_TsiAlPhzZIKfHW",
    SINGLE_SYSTEM_3: "prod_TsiAjjN0MymyAv",
    SINGLE_SYSTEM_4: "prod_TsiBgb2TuYyr0p",
  },
};

// Promotion configuration
const ALL_SYSTEMS_YEARLY_PRODUCT_IDS = {
  test: PRODUCT_IDS.test.ALL_SYSTEMS_YEARLY,
  production: PRODUCT_IDS.production.ALL_SYSTEMS_YEARLY,
};

const COUPON_IDS = {
  test: process.env.STRIPE_PROMOTION_COUPON_ID || "16GlRQW9", // Use env var if set, fallback to hardcoded
  production: process.env.STRIPE_PROMOTION_COUPON_ID || "", // Live coupon ID
};

// Helper functions to check product types
const isProduction = () => process.env.NODE_ENV === "production";

const getAllSystemsProductIds = () => {
  const env = isProduction() ? "production" : "test";
  return [
    PRODUCT_IDS[env].ALL_SYSTEMS_YEARLY,
    PRODUCT_IDS[env].ALL_SYSTEMS_MONTHLY,
  ];
};

const getSingleSystemProductIds = () => {
  const env = isProduction() ? "production" : "test";
  return [
    PRODUCT_IDS[env].SINGLE_SYSTEM_1,
    PRODUCT_IDS[env].SINGLE_SYSTEM_2,
    PRODUCT_IDS[env].SINGLE_SYSTEM_3,
    PRODUCT_IDS[env].SINGLE_SYSTEM_4,
  ];
};

const isAllSystemsProduct = (productId) => {
  return getAllSystemsProductIds().includes(productId);
};

const isSingleSystemProduct = (productId) => {
  return getSingleSystemProductIds().includes(productId);
};

/**
 * Check if promotion should be applied and return coupon ID if applicable
 * @param {string} productId - The Stripe product ID
 * @returns {string|null} - Coupon ID if promotion should be applied, null otherwise
 */
const getPromotionCouponId = (productId) => {
  const prod = isProduction();

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
  const promotionEnd = new Date("2126-12-31T23:59:59Z"); // End in future for testing

  // Production dates (uncomment when ready for production):
  // const promotionStart = new Date("2026-01-01T00:00:00Z");
  // const promotionEnd = new Date("2026-01-31T23:59:59Z");

  const isPromotionActive = now >= promotionStart && now <= promotionEnd;

  if (!isPromotionActive) {
    return null;
  }

  // Get the appropriate coupon ID for current environment
  const couponId = prod ? COUPON_IDS.production : COUPON_IDS.test;

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
  const promotionEnd = new Date("2126-12-31T23:59:59Z");

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

    // Add contact to Brevo only in production
    if (isProduction()) {
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

    // 3.5. Add contact to Brevo only in production
    if (isProduction()) {
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
    }

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

    // Check if there's a pending change (scheduled downgrade/upgrade)
    const hasPendingChange = stripeSubscription.pending_update !== null;
    const pendingChange = hasPendingChange ? stripeSubscription.pending_update : null;
    
    // Check if there's a pending change stored in metadata (for yearly downgrades)
    const hasPendingInMetadata = subscription.metadata?.pendingProductId;
    
    console.log("*** [GET BILLING DETAILS] Pending change detection ***", {
      subscriptionId: subscription.stripeSubscriptionId,
      hasPendingChange,
      hasPendingInMetadata,
      pendingUpdate: stripeSubscription.pending_update,
      pendingProductId: subscription.metadata?.pendingProductId,
      pendingSystemSlugs: subscription.metadata?.pendingSystemSlugs,
      currentProductId: subscription.productId,
      currentSystemSlugs: subscription.metadata?.systemSlugs,
    });

    // For pending changes, use CURRENT productId/systemSlugs (not the pending ones)
    // This ensures user sees their current access until the change takes effect
    const currentProductId = subscription.productId; // Current plan, not pending
    const currentSystemSlugs = subscription.metadata?.systemSlugs 
      ? JSON.parse(subscription.metadata.systemSlugs)
      : [];

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

    // Get price and product details - use CURRENT productId if there's a pending change
    // Otherwise use what's in Stripe (which might be the new plan if change already applied)
    let priceIdToUse = stripeSubscription.items.data[0].price.id;
    let productIdToUse = stripeSubscription.items.data[0].price.product;
    
    console.log("*** [GET BILLING DETAILS] Initial product selection ***", {
      stripeProductId: productIdToUse,
      stripePriceId: priceIdToUse,
      willUseCurrent: hasPendingChange || hasPendingInMetadata,
    });
    
    if (hasPendingChange || hasPendingInMetadata) {
      // Use current productId from database (the plan they still have access to)
      productIdToUse = currentProductId;
      console.log("*** [GET BILLING DETAILS] Using CURRENT productId (pending change detected) ***", {
        currentProductId: currentProductId,
        stripeProductId: stripeSubscription.items.data[0].price.product,
      });
      // Get the price for the current product
      const currentPrices = await stripe.prices.list({
        product: currentProductId,
        active: true,
        limit: 1,
      });
      if (currentPrices.data.length > 0) {
        priceIdToUse = currentPrices.data[0].id;
        console.log("*** [GET BILLING DETAILS] Found price for current product ***", {
          priceId: priceIdToUse,
          amount: currentPrices.data[0].unit_amount,
          interval: currentPrices.data[0].recurring?.interval,
        });
      } else {
        console.error("*** [GET BILLING DETAILS] ERROR: No price found for current productId ***", {
          productId: currentProductId,
        });
      }
    } else {
      console.log("*** [GET BILLING DETAILS] No pending change, using Stripe productId ***");
    }
    
    const price = await stripe.prices.retrieve(priceIdToUse);
    const product = await stripe.products.retrieve(productIdToUse);
    
    console.log("*** [GET BILLING DETAILS] Final product/price used ***", {
      productId: productIdToUse,
      productName: product.name,
      priceId: priceIdToUse,
      priceAmount: price.unit_amount,
      priceInterval: price.recurring?.interval,
    });

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

    // Get systems for plan description - use current systemSlugs if pending change
    const systems = await System.find({ isActive: true });
    
    // Create a temporary subscription object with current systemSlugs for description
    const subscriptionForDescription = {
      ...subscription.toObject(),
      metadata: {
        ...subscription.metadata,
        systemSlugs: JSON.stringify(currentSystemSlugs),
      },
    };

    // Get pending change details if exists
    let pendingChangeInfo = null;
    if (hasPendingChange || hasPendingInMetadata) {
      console.log("*** [GET BILLING DETAILS] Building pending change info ***");
      const pendingProductId = subscription.metadata?.pendingProductId || 
        (pendingChange?.items?.data?.[0]?.price?.product);
      const pendingSystemSlugs = subscription.metadata?.pendingSystemSlugs
        ? JSON.parse(subscription.metadata.pendingSystemSlugs)
        : [];
      
      console.log("*** [GET BILLING DETAILS] Pending change details ***", {
        pendingProductId,
        pendingSystemSlugs,
        fromMetadata: !!subscription.metadata?.pendingProductId,
        fromStripePendingUpdate: !!pendingChange?.items?.data?.[0]?.price?.product,
      });
      
      if (pendingProductId) {
        const pendingProduct = await stripe.products.retrieve(pendingProductId);
        const pendingPrices = await stripe.prices.list({
          product: pendingProductId,
          active: true,
          limit: 1,
        });
        
        pendingChangeInfo = {
          productId: pendingProductId,
          productName: pendingProduct.name,
          systemSlugs: pendingSystemSlugs,
          effectiveDate: subscription.currentPeriodEnd 
            ? subscription.currentPeriodEnd.toISOString()
            : null,
          description: getPlanDescription(
            { metadata: { systemSlugs: JSON.stringify(pendingSystemSlugs) } },
            systems
          ),
        };
        
        console.log("*** [GET BILLING DETAILS] Pending change info created ***", {
          productId: pendingChangeInfo.productId,
          productName: pendingChangeInfo.productName,
          systemSlugs: pendingChangeInfo.systemSlugs,
          effectiveDate: pendingChangeInfo.effectiveDate,
          description: pendingChangeInfo.description,
        });
      } else {
        console.error("*** [GET BILLING DETAILS] ERROR: Pending change detected but no pendingProductId found ***");
      }
    } else {
      console.log("*** [GET BILLING DETAILS] No pending change, pendingChangeInfo = null ***");
    }

    // Format response
    const response = {
      hasSubscription: true,
      currentPlan: {
        name: product.name || subscription.plan,
        status: subscription.status,
        description: getPlanDescription(subscriptionForDescription, systems),
        price: (price.unit_amount / 100).toFixed(2),
        currency: price.currency.toUpperCase(),
        period: price.recurring?.interval || "month",
        nextBillingDate: nextBillingDate ? nextBillingDate.toISOString() : null,
        productId: currentProductId, // Current productId (what they have access to now)
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
        // Add pending change info if exists
        pendingChange: pendingChangeInfo,
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

// Helper function to update user's activeSystemIds
const updateUserActiveSystemIds = async (userId) => {
  try {
    const System = require("../models/System");
    const activeSubscriptions = await StripeSubscription.find({
      userId,
      status: { $in: ["active", "trialing"] },
    });

    const allSystemSlugs = new Set();
    for (const sub of activeSubscriptions) {
      if (sub.metadata && sub.metadata.systemSlugs) {
        try {
          const parsed = JSON.parse(sub.metadata.systemSlugs);
          if (Array.isArray(parsed)) {
            parsed.forEach((slug) => allSystemSlugs.add(slug));
          }
        } catch (e) {
          console.error(
            `Error parsing systemSlugs for subscription ${sub.stripeSubscriptionId}:`,
            e
          );
        }
      }
    }

    const systems = await System.find({
      slug: { $in: Array.from(allSystemSlugs) },
    });

    const user = await User.findById(userId);
    if (user) {
      user.activeSystemIds = systems.map((system) => system._id);
      await user.save();
      console.log(
        `User ${userId} activeSystemIds updated:`,
        user.activeSystemIds
      );
    }
  } catch (error) {
    console.error("Error updating user activeSystemIds:", error);
    throw error;
  }
};

// Helper function to calculate unused time credit (in pence)
const calculateUnusedTimeCredit = async (stripeSubscription) => {
  const currentPeriodStart = stripeSubscription.current_period_start;
  const currentPeriodEnd = stripeSubscription.current_period_end;
  const now = Math.floor(Date.now() / 1000);
  
  // Calculate remaining time in current period (in seconds)
  const remainingSeconds = currentPeriodEnd - now;
  const totalPeriodSeconds = currentPeriodEnd - currentPeriodStart;
  
  if (remainingSeconds <= 0 || totalPeriodSeconds <= 0) {
    return 0;
  }
  
  // Get the price amount
  const priceAmount = stripeSubscription.items.data[0].price.unit_amount;
  if (!priceAmount) {
    return 0;
  }
  
  // Calculate prorated credit
  const creditAmount = Math.floor((priceAmount * remainingSeconds) / totalPeriodSeconds);
  
  return creditAmount;
};

// @desc    Downgrade to Monthly Single System
// @route   POST /api/users/change-subscription (with changeType: "downgradeToMonthlySingleSystem")
// @access  Private
const downgradeToMonthlySingleSystem = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, systemSlugs } = req.body;
    const userId = req.user.id;

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] req.body ***", req.body);

    if (!stripeSubscriptionId || !newProductId) {
      return res.status(400).json({
        message: "Subscription ID and product ID are required",
      });
    }

    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] subscription (before) ***", {
      _id: subscription?._id,
      productId: subscription?.productId,
      plan: subscription?.plan,
      status: subscription?.status,
      currentPeriodStart: subscription?.currentPeriodStart,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      metadata: subscription?.metadata,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Get price for new product
    const prices = await stripe.prices.list({
      product: newProductId,
      active: true,
      limit: 1,
    });

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] prices ***", {
      found: prices.data.length > 0,
      priceId: prices.data[0]?.id,
      amount: prices.data[0]?.unit_amount,
      currency: prices.data[0]?.currency,
    });

    if (prices.data.length === 0) {
      return res.status(400).json({
        message: "No active price found for the given product.",
      });
    }

    const activePriceId = prices.data[0].id;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] stripeSubscription (before) ***", {
      id: stripeSubscription.id,
      status: stripeSubscription.status,
      current_period_start: stripeSubscription.current_period_start,
      current_period_end: stripeSubscription.current_period_end,
      billing_cycle_anchor: stripeSubscription.billing_cycle_anchor,
      plan: {
        id: stripeSubscription.items.data[0]?.price?.id,
        product: stripeSubscription.items.data[0]?.price?.product,
        amount: stripeSubscription.items.data[0]?.price?.unit_amount,
        interval: stripeSubscription.items.data[0]?.price?.recurring?.interval,
      },
      metadata: stripeSubscription.metadata,
    });

    // Downgrade: schedule for period end, no payment needed
    // Same interval (monthly to monthly), so use billing_cycle_anchor: "unchanged"
    const updateParams = {
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: activePriceId,
        },
      ],
      proration_behavior: "none", // No proration for downgrades
      billing_cycle_anchor: "unchanged", // Same interval, schedule for period end
      metadata: {
        userId: userId.toString(),
        productId: newProductId,
        systemSlugs: JSON.stringify(systemSlugs || []),
      },
    };

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] Stripe update params ***", updateParams);

    const updatedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      updateParams
    );

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] Stripe update response (full) ***", updatedSubscription);
    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] Stripe update response (key fields) ***", {
      id: updatedSubscription.id,
      status: updatedSubscription.status,
      current_period_start: updatedSubscription.current_period_start,
      current_period_end: updatedSubscription.current_period_end,
      billing_cycle_anchor: updatedSubscription.billing_cycle_anchor,
      plan: {
        id: updatedSubscription.items.data[0]?.price?.id,
        product: updatedSubscription.items.data[0]?.price?.product,
        amount: updatedSubscription.items.data[0]?.price?.unit_amount,
        interval: updatedSubscription.items.data[0]?.price?.recurring?.interval,
      },
      metadata: updatedSubscription.metadata,
      pending_update: updatedSubscription.pending_update, // Important: shows if change is scheduled
    });

    // Update database - validate dates before setting
    subscription.productId = newProductId;
    subscription.plan = activePriceId;
    subscription.status = updatedSubscription.status;
    
    // Validate and set currentPeriodStart
    if (
      updatedSubscription.current_period_start &&
      typeof updatedSubscription.current_period_start === "number"
    ) {
      subscription.currentPeriodStart = new Date(
        updatedSubscription.current_period_start * 1000
      );
    }
    
    // Validate and set currentPeriodEnd
    if (
      updatedSubscription.current_period_end &&
      typeof updatedSubscription.current_period_end === "number"
    ) {
      subscription.currentPeriodEnd = new Date(
        updatedSubscription.current_period_end * 1000
      );
    }
    
    subscription.metadata = {
      ...subscription.metadata,
      productId: newProductId,
      systemSlugs: JSON.stringify(systemSlugs || []),
    };
    await subscription.save();

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] subscription (after save) ***", {
      productId: subscription.productId,
      plan: subscription.plan,
      status: subscription.status,
      metadata: subscription.metadata,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });

    await updateUserActiveSystemIds(userId);

    const effectiveDate = updatedSubscription.current_period_end
      ? new Date(updatedSubscription.current_period_end * 1000).toISOString()
      : new Date().toISOString();

    console.log("*** [DOWNGRADE TO SINGLE SYSTEM] Response ***", {
      success: true,
      effectiveDate: effectiveDate,
      isChangingInterval: false,
    });

    res.json({
      success: true,
      message: "Subscription change scheduled for end of current billing period",
      effectiveDate: effectiveDate,
      isChangingInterval: false, // Same interval (monthly to monthly)
    });
  } catch (error) {
    console.error("Error downgrading to monthly single system:", error);
    res.status(500).json({
      message: error.message || "Failed to downgrade subscription",
    });
  }
};

// @desc    Downgrade to All Systems Monthly
// @route   POST /api/users/change-subscription (with changeType: "downgradeToAllSystemsMonthly")
// @access  Private
const downgradeToAllSystemsMonthly = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, systemSlugs } = req.body;
    const userId = req.user.id;

    if (!stripeSubscriptionId || !newProductId) {
      return res.status(400).json({
        message: "Subscription ID and product ID are required",
      });
    }

    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Get price for new product
    const prices = await stripe.prices.list({
      product: newProductId,
      active: true,
      limit: 1,
    });

    if (prices.data.length === 0) {
      return res.status(400).json({
        message: "No active price found for the given product.",
      });
    }

    const activePriceId = prices.data[0].id;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    // Downgrade: schedule for period end (changing from yearly to monthly)
    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: activePriceId,
        },
      ],
      proration_behavior: "none",
      // Omit billing_cycle_anchor - Stripe will schedule for period end when interval changes
      metadata: {
        userId: userId.toString(),
        productId: newProductId,
        systemSlugs: JSON.stringify(systemSlugs || []),
      },
    });

    const updatedSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    // Update database
    subscription.productId = newProductId;
    subscription.plan = activePriceId;
    subscription.status = updatedSubscription.status;
    subscription.currentPeriodStart = new Date(
      updatedSubscription.current_period_start * 1000
    );
    subscription.currentPeriodEnd = new Date(
      updatedSubscription.current_period_end * 1000
    );
    subscription.metadata = {
      ...subscription.metadata,
      productId: newProductId,
      systemSlugs: JSON.stringify(systemSlugs || []),
    };
    await subscription.save();

    await updateUserActiveSystemIds(userId);

    res.json({
      success: true,
      message: "Subscription change scheduled for end of current billing period",
      effectiveDate: new Date(
        updatedSubscription.current_period_end * 1000
      ).toISOString(),
      isChangingInterval: true,
    });
  } catch (error) {
    console.error("Error downgrading to all systems monthly:", error);
    res.status(500).json({
      message: error.message || "Failed to downgrade subscription",
    });
  }
};

// @desc    Downgrade from All Systems Yearly
// @route   POST /api/users/change-subscription (with changeType: "downgradeFromAllSystemsYearly")
// @access  Private
// Handles downgrades from yearly to either single system monthly or all systems monthly
// User retains access until billing cycle ends (no immediate restriction)
const downgradeFromAllSystemsYearly = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, systemSlugs } = req.body;
    const userId = req.user.id;

    console.log("*** [DOWNGRADE FROM YEARLY] req.body ***", req.body);

    if (!stripeSubscriptionId || !newProductId) {
      return res.status(400).json({
        message: "Subscription ID and product ID are required",
      });
    }

    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    console.log("*** [DOWNGRADE FROM YEARLY] subscription (before) ***", {
      _id: subscription?._id,
      productId: subscription?.productId,
      plan: subscription?.plan,
      status: subscription?.status,
      currentPeriodStart: subscription?.currentPeriodStart,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      metadata: subscription?.metadata,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Get price for new product
    const prices = await stripe.prices.list({
      product: newProductId,
      active: true,
      limit: 1,
    });

    console.log("*** [DOWNGRADE FROM YEARLY] prices ***", {
      found: prices.data.length > 0,
      priceId: prices.data[0]?.id,
      amount: prices.data[0]?.unit_amount,
      currency: prices.data[0]?.currency,
      interval: prices.data[0]?.recurring?.interval,
    });

    if (prices.data.length === 0) {
      return res.status(400).json({
        message: "No active price found for the given product.",
      });
    }

    const activePriceId = prices.data[0].id;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    console.log("*** [DOWNGRADE FROM YEARLY] stripeSubscription (before) ***", {
      id: stripeSubscription.id,
      status: stripeSubscription.status,
      current_period_start: stripeSubscription.current_period_start,
      current_period_end: stripeSubscription.current_period_end,
      billing_cycle_anchor: stripeSubscription.billing_cycle_anchor,
      plan: {
        id: stripeSubscription.items.data[0]?.price?.id,
        product: stripeSubscription.items.data[0]?.price?.product,
        amount: stripeSubscription.items.data[0]?.price?.unit_amount,
        interval: stripeSubscription.items.data[0]?.price?.recurring?.interval,
      },
      metadata: stripeSubscription.metadata,
    });

    // Downgrade from yearly: schedule for period end, no proration, no immediate restriction
    // Changing interval (yearly to monthly), so omit billing_cycle_anchor - Stripe schedules for period end
    const updateParams = {
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: activePriceId,
        },
      ],
      proration_behavior: "none", // No proration for downgrades
      // Omit billing_cycle_anchor - Stripe will schedule for period end when interval changes
      metadata: {
        userId: userId.toString(),
        productId: newProductId,
        systemSlugs: JSON.stringify(systemSlugs || []),
      },
    };

    console.log("*** [DOWNGRADE FROM YEARLY] Stripe update params ***", updateParams);

    const updatedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      updateParams
    );

    console.log("*** [DOWNGRADE FROM YEARLY] Stripe update response (full) ***", updatedSubscription);
    console.log("*** [DOWNGRADE FROM YEARLY] Stripe update response (key fields) ***", {
      id: updatedSubscription.id,
      status: updatedSubscription.status,
      current_period_start: updatedSubscription.current_period_start,
      current_period_end: updatedSubscription.current_period_end,
      billing_cycle_anchor: updatedSubscription.billing_cycle_anchor,
      plan: {
        id: updatedSubscription.items.data[0]?.price?.id,
        product: updatedSubscription.items.data[0]?.price?.product,
        amount: updatedSubscription.items.data[0]?.price?.unit_amount,
        interval: updatedSubscription.items.data[0]?.price?.recurring?.interval,
      },
      metadata: updatedSubscription.metadata,
      pending_update: updatedSubscription.pending_update, // Important: shows if change is scheduled
      pending_update_details: updatedSubscription.pending_update ? {
        expires_at: updatedSubscription.pending_update.expires_at,
        subscription_items: updatedSubscription.pending_update.subscription_items,
      } : null,
    });

    // For yearly downgrades, DO NOT update productId/systemSlugs in database yet
    // User retains access until period ends. Store pending change in metadata.
    // The webhook will update productId/systemSlugs when the change actually takes effect
    console.log("*** [DOWNGRADE FROM YEARLY] BEFORE metadata update ***", {
      current_productId: subscription.productId,
      current_plan: subscription.plan,
      current_systemSlugs: subscription.metadata?.systemSlugs,
      new_productId: newProductId,
      new_systemSlugs: systemSlugs,
    });
    
    subscription.metadata = {
      ...subscription.metadata,
      // Keep current productId and systemSlugs for access control
      // Store pending values separately
      pendingProductId: newProductId,
      pendingSystemSlugs: JSON.stringify(systemSlugs || []),
      pendingPlan: activePriceId,
    };
    subscription.status = updatedSubscription.status;
    await subscription.save();

    console.log("*** [DOWNGRADE FROM YEARLY] subscription (after save) ***", {
      productId: subscription.productId, // Still the old yearly productId
      plan: subscription.plan, // Still the old yearly plan
      status: subscription.status,
      metadata: subscription.metadata,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      pendingProductId: subscription.metadata.pendingProductId,
      pendingSystemSlugs: subscription.metadata.pendingSystemSlugs,
      pendingPlan: subscription.metadata.pendingPlan,
    });
    
    // Verify productId was NOT changed
    if (subscription.productId === newProductId) {
      console.error("*** [DOWNGRADE FROM YEARLY] ERROR: productId was updated! It should remain as the current plan. ***");
    } else {
      console.log("*** [DOWNGRADE FROM YEARLY] ✓ productId correctly NOT updated, remains as current plan ***");
    }

    // DO NOT call updateUserActiveSystemIds - keep current access until period ends
    console.log("*** [DOWNGRADE FROM YEARLY] Skipping updateUserActiveSystemIds - user retains current access until period ends ***");

    const effectiveDate = updatedSubscription.current_period_end
      ? new Date(updatedSubscription.current_period_end * 1000).toISOString()
      : new Date().toISOString();

    console.log("*** [DOWNGRADE FROM YEARLY] Response ***", {
      success: true,
      effectiveDate: effectiveDate,
      isChangingInterval: true,
    });

    res.json({
      success: true,
      message: "Subscription change scheduled for end of current billing period. You will retain access until then.",
      effectiveDate: effectiveDate,
      isChangingInterval: true, // Changing from yearly to monthly
    });
  } catch (error) {
    console.error("Error downgrading from all systems yearly:", error);
    res.status(500).json({
      message: error.message || "Failed to downgrade subscription",
    });
  }
};

// @desc    Upgrade to All Systems Monthly
// @route   POST /api/users/change-subscription (with changeType: "upgradeToAllSystemsMonthly")
// @access  Private
const upgradeToAllSystemsMonthly = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, systemSlugs } = req.body;
    console.log("*** req.body ***", req.body);
    const userId = req.user.id;

    if (!stripeSubscriptionId || !newProductId) {
      return res.status(400).json({
        message: "Subscription ID and product ID are required",
      });
    }

    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });
    console.log("*** subscription ***", subscription);

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Get price for new product
    const prices = await stripe.prices.list({
      product: newProductId,
      active: true,
      limit: 1,
    });
    console.log("*** prices ***", prices);

    if (prices.data.length === 0) {
      return res.status(400).json({
        message: "No active price found for the given product.",
      });
    }

    const activePriceId = prices.data[0].id;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );
    console.log("*** stripeSubscription ***", stripeSubscription);

    // // Upgrade: immediate, with proration to credit unused single system time
    const updatedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      {
        items: [
          {
            id: stripeSubscription.items.data[0].id,
            price: activePriceId,
          },
        ],
        proration_behavior: "create_prorations", // Credit unused time
        billing_cycle_anchor: "unchanged", // Same interval (monthly)
        metadata: {
          userId: userId.toString(),
          productId: newProductId,
          systemSlugs: JSON.stringify(systemSlugs || []),
        },
      }
    );
    console.log("*** updatedSubscription ***", updatedSubscription);

    // Update database immediately - validate dates before setting
    subscription.productId = newProductId;
    subscription.plan = activePriceId;
    subscription.status = updatedSubscription.status;
    
    // Validate and set currentPeriodStart - only if Stripe provides it
    if (
      updatedSubscription.current_period_start &&
      typeof updatedSubscription.current_period_start === "number"
    ) {
      subscription.currentPeriodStart = new Date(
        updatedSubscription.current_period_start * 1000
      );
    }
    // If not provided, keep existing value (don't set to invalid date)
    
    // Validate and set currentPeriodEnd - only if Stripe provides it
    if (
      updatedSubscription.current_period_end &&
      typeof updatedSubscription.current_period_end === "number"
    ) {
      subscription.currentPeriodEnd = new Date(
        updatedSubscription.current_period_end * 1000
      );
    }
    // If not provided, keep existing value (don't set to invalid date)
    
    subscription.metadata = {
      ...subscription.metadata,
      productId: newProductId,
      systemSlugs: JSON.stringify(systemSlugs || []),
    };
    await subscription.save();
    console.log("*** subscription (after save) ***", {
      productId: subscription.productId,
      plan: subscription.plan,
      status: subscription.status,
      metadata: subscription.metadata,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
    });

    await updateUserActiveSystemIds(userId);

    // When upgrading with proration, Stripe creates pending invoice items
    // We need to create and finalize an invoice to charge the customer immediately
    try {
      // Store return URL in metadata for reference (Stripe hosted invoices don't support redirects)
      const returnUrl = `${process.env.FRONTEND_URL}/dashboard/payment/success`;
      
      // Create an invoice for the pending invoice items (proration charges)
      const invoice = await stripe.invoices.create({
        customer: stripeSubscription.customer,
        subscription: stripeSubscriptionId,
        auto_advance: true, // Automatically finalize and attempt payment
        metadata: {
          returnUrl: returnUrl,
          upgradeType: "upgradeToAllSystemsMonthly",
        },
      });

      console.log("*** created invoice ***", invoice);

      // If invoice needs payment, finalize it and get payment URL
      if (invoice.status === "draft") {
        const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
        console.log("*** finalized invoice ***", finalizedInvoice);

        if (finalizedInvoice.status === "open" && finalizedInvoice.amount_due > 0) {
          // Note: Stripe's hosted invoice pages don't support automatic redirects
          // User will need to navigate back manually after payment
          return res.json({
            url: finalizedInvoice.hosted_invoice_url,
            requiresCheckout: true,
            message: "Redirecting to complete payment. After payment, please return to your dashboard.",
            returnUrl: returnUrl, // Include in response so frontend can show a message
          });
        }
      }

      // If invoice is already paid or has no amount due, upgrade is complete
      if (invoice.status === "paid" || invoice.amount_due === 0) {
        return res.json({
          success: true,
          message: "Subscription upgraded successfully",
          effectiveDate: new Date().toISOString(),
        });
      }
    } catch (invoiceError) {
      console.error("Error creating invoice for proration:", invoiceError);
      // If invoice creation fails, still return success since subscription is updated
      // The proration will be included in the next billing cycle
    }

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      effectiveDate: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error upgrading to all systems monthly:", error);
    res.status(500).json({
      message: error.message || "Failed to upgrade subscription",
    });
  }
};

// @desc    Upgrade to All Systems Yearly
// @route   POST /api/users/change-subscription (with changeType: "upgradeToAllSystemsYearly")
// @access  Private
const upgradeToAllSystemsYearly = async (req, res) => {
  try {
    const { stripeSubscriptionId, newProductId, systemSlugs } = req.body;
    const userId = req.user.id;

    console.log("*** [UPGRADE TO YEARLY] req.body ***", req.body);

    if (!stripeSubscriptionId || !newProductId) {
      return res.status(400).json({
        message: "Subscription ID and product ID are required",
      });
    }

    const subscription = await StripeSubscription.findOne({
      userId,
      stripeSubscriptionId,
    });

    console.log("*** [UPGRADE TO YEARLY] subscription (before) ***", {
      _id: subscription?._id,
      productId: subscription?.productId,
      plan: subscription?.plan,
      status: subscription?.status,
      currentPeriodStart: subscription?.currentPeriodStart,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      metadata: subscription?.metadata,
    });

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    if (subscription.cancelAtPeriodEnd) {
      return res.status(400).json({
        message:
          "Cannot change subscription while it is scheduled for cancellation. Please resume first.",
      });
    }

    // Get price for new product
    const prices = await stripe.prices.list({
      product: newProductId,
      active: true,
      limit: 1,
    });

    console.log("*** [UPGRADE TO YEARLY] prices ***", {
      found: prices.data.length > 0,
      priceId: prices.data[0]?.id,
      amount: prices.data[0]?.unit_amount,
      currency: prices.data[0]?.currency,
      interval: prices.data[0]?.recurring?.interval,
    });

    if (prices.data.length === 0) {
      return res.status(400).json({
        message: "No active price found for the given product.",
      });
    }

    const activePriceId = prices.data[0].id;
    const stripeSubscription = await stripe.subscriptions.retrieve(
      stripeSubscriptionId
    );

    console.log("*** [UPGRADE TO YEARLY] stripeSubscription (before) ***", {
      id: stripeSubscription.id,
      status: stripeSubscription.status,
      current_period_start: stripeSubscription.current_period_start,
      current_period_end: stripeSubscription.current_period_end,
      billing_cycle_anchor: stripeSubscription.billing_cycle_anchor,
      plan: {
        id: stripeSubscription.items.data[0]?.price?.id,
        product: stripeSubscription.items.data[0]?.price?.product,
        amount: stripeSubscription.items.data[0]?.price?.unit_amount,
        interval: stripeSubscription.items.data[0]?.price?.recurring?.interval,
      },
      metadata: stripeSubscription.metadata,
    });

    // Get coupon ID
    const couponId = getPromotionCouponId(newProductId);
    console.log("*** [UPGRADE TO YEARLY] couponId ***", couponId);

    // Upgrade: immediate, with Stripe's automatic proration + coupon
    // Changing intervals (monthly to yearly), so use billing_cycle_anchor: "now"
    const updateParams = {
      items: [
        {
          id: stripeSubscription.items.data[0].id,
          price: activePriceId,
        },
      ],
      proration_behavior: "create_prorations", // Stripe automatically calculates and credits unused time
      billing_cycle_anchor: "now", // Start new yearly cycle immediately (changing intervals)
      metadata: {
        userId: userId.toString(),
        productId: newProductId,
        systemSlugs: JSON.stringify(systemSlugs || []),
      },
    };

    if (couponId) {
      try {
        const coupon = await stripe.coupons.retrieve(couponId);
        if (coupon.valid) {
          updateParams.discounts = [{ coupon: couponId }];
          console.log(
            `*** [UPGRADE TO YEARLY] Applying coupon ${couponId} - 50% off yearly plan`
          );
        }
      } catch (couponError) {
        console.error(
          `*** [UPGRADE TO YEARLY] Error verifying coupon ${couponId}:`,
          couponError.message
        );
      }
    }

    console.log("*** [UPGRADE TO YEARLY] Stripe update params ***", updateParams);

    const updatedSubscription = await stripe.subscriptions.update(
      stripeSubscriptionId,
      updateParams
    );

    console.log("*** [UPGRADE TO YEARLY] Stripe update response (full) ***", updatedSubscription);
    console.log("*** [UPGRADE TO YEARLY] Stripe update response (key fields) ***", {
      id: updatedSubscription.id,
      status: updatedSubscription.status,
      current_period_start: updatedSubscription.current_period_start,
      current_period_end: updatedSubscription.current_period_end,
      billing_cycle_anchor: updatedSubscription.billing_cycle_anchor,
      plan: {
        id: updatedSubscription.items.data[0]?.price?.id,
        product: updatedSubscription.items.data[0]?.price?.product,
        amount: updatedSubscription.items.data[0]?.price?.unit_amount,
        interval: updatedSubscription.items.data[0]?.price?.recurring?.interval,
      },
      discounts: updatedSubscription.discounts,
      metadata: updatedSubscription.metadata,
      latest_invoice: updatedSubscription.latest_invoice,
    });

    // Update database - only update productId, plan, status, and metadata
    // Let the webhook handle period dates from Stripe (single source of truth)
    subscription.productId = newProductId;
    subscription.plan = activePriceId;
    subscription.status = updatedSubscription.status;
    
    subscription.metadata = {
      ...subscription.metadata,
      productId: newProductId,
      systemSlugs: JSON.stringify(systemSlugs || []),
    };
    
    await subscription.save();

    await updateUserActiveSystemIds(userId);

    // When upgrading with proration + coupon, Stripe automatically creates an invoice
    // Check the latest_invoice from the subscription update response
    const latestInvoiceId = updatedSubscription.latest_invoice;
    console.log("*** [UPGRADE TO YEARLY] latest_invoice from subscription update ***", latestInvoiceId);

    if (latestInvoiceId) {
      try {
        const invoice = await stripe.invoices.retrieve(latestInvoiceId);
        console.log("*** [UPGRADE TO YEARLY] latest invoice (full) ***", invoice);
        console.log("*** [UPGRADE TO YEARLY] latest invoice (key fields) ***", {
          id: invoice.id,
          status: invoice.status,
          amount_due: invoice.amount_due,
          subtotal: invoice.subtotal,
          total: invoice.total,
          discounts: invoice.discounts,
          lines: invoice.lines?.data?.map(line => ({
            amount: line.amount,
            description: line.description,
            proration: line.proration,
          })),
        });

        // Always redirect to invoice page so user can see what they paid
        // This ensures consistent behavior with upgradeToAllSystemsMonthly
        
        // If invoice is already paid, still redirect to show receipt
        if (invoice.status === "paid" && invoice.hosted_invoice_url) {
          const returnUrl = `${process.env.FRONTEND_URL}/dashboard/payment/success`;
          return res.json({
            url: invoice.hosted_invoice_url,
            requiresCheckout: true,
            message: "Payment completed. Viewing invoice receipt.",
            returnUrl: returnUrl,
          });
        }

        // If invoice needs payment, finalize it and get payment URL
        if (invoice.status === "open" && invoice.amount_due > 0) {
          // Invoice is already finalized, just redirect
          if (invoice.hosted_invoice_url) {
            const returnUrl = `${process.env.FRONTEND_URL}/dashboard/payment/success`;
            return res.json({
              url: invoice.hosted_invoice_url,
              requiresCheckout: true,
              message: "Redirecting to complete payment. After payment, please return to your dashboard.",
              returnUrl: returnUrl,
            });
          }
        }

        // If invoice is draft, finalize it
        if (invoice.status === "draft") {
          const finalizedInvoice = await stripe.invoices.finalizeInvoice(latestInvoiceId);
          console.log("*** [UPGRADE TO YEARLY] finalized draft invoice ***", finalizedInvoice);

          if (finalizedInvoice.hosted_invoice_url) {
            const returnUrl = `${process.env.FRONTEND_URL}/dashboard/payment/success`;
            return res.json({
              url: finalizedInvoice.hosted_invoice_url,
              requiresCheckout: true,
              message: finalizedInvoice.status === "paid" 
                ? "Payment completed. Viewing invoice receipt."
                : "Redirecting to complete payment. After payment, please return to your dashboard.",
              returnUrl: returnUrl,
            });
          }
        }
      } catch (invoiceError) {
        console.error("*** [UPGRADE TO YEARLY] Error retrieving invoice:", invoiceError);
      }
    }

    res.json({
      success: true,
      message: "Subscription upgraded successfully",
      effectiveDate: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error upgrading to all systems yearly:", error);
    res.status(500).json({
      message: error.message || "Failed to upgrade subscription",
    });
  }
};

// @desc    Change subscription (router function - calls appropriate handler)
// @route   POST /api/users/change-subscription
// @access  Private
const changeSubscription = async (req, res) => {
  try {
    const { changeType, stripeSubscriptionId, newProductId, systemSlugs } = req.body;

    if (!changeType) {
      return res.status(400).json({
        message: "changeType is required",
      });
    }

    // Route to appropriate handler based on changeType
    switch (changeType) {
      case "downgradeToMonthlySingleSystem":
        return await downgradeToMonthlySingleSystem(req, res);
      case "downgradeToAllSystemsMonthly":
        return await downgradeToAllSystemsMonthly(req, res);
      case "downgradeFromAllSystemsYearly":
        return await downgradeFromAllSystemsYearly(req, res);
      case "upgradeToAllSystemsMonthly":
        return await upgradeToAllSystemsMonthly(req, res);
      case "upgradeToAllSystemsYearly":
        return await upgradeToAllSystemsYearly(req, res);
      default:
        return res.status(400).json({
          message: `Invalid changeType: ${changeType}`,
        });
    }
  } catch (error) {
    console.error("Error in changeSubscription router:", error);
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

// @desc    Subscribe to automation bot updates
// @route   POST /api/users/automation-bot-subscribe
// @access  Public
const subscribeToAutomationBot = async (req, res) => {
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

    // Add contact to Brevo with list 6
    const normalizedEmail = email.toLowerCase().trim();
    const attributes = {
      FIRSTNAME: firstName || "",
      LASTNAME: lastName || "",
    };

    try {
      // Try to create the contact
      await createBrevoContact(normalizedEmail, attributes, [6]);
      res.json({
        success: true,
        message: "Successfully subscribed to automation bot updates",
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
          // Contact already exists, just add them to list 6
          await addContactToList(6, [normalizedEmail]);

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
            message: "Successfully subscribed to automation bot updates",
          });
        } catch (addToListError) {
          console.error(
            "Failed to add existing contact to automation bot list:",
            addToListError
          );
          res.status(500).json({
            message:
              "Failed to subscribe to automation bot updates. Please try again later.",
          });
        }
      } else {
        // Some other error occurred
        console.error(
          "Failed to subscribe to automation bot in Brevo:",
          brevoError
        );
        res.status(500).json({
          message:
            "Failed to subscribe to automation bot updates. Please try again later.",
        });
      }
    }
  } catch (error) {
    console.error("Error in subscribeToAutomationBot:", error);
    res
      .status(500)
      .json({ message: "Failed to process automation bot subscription" });
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
  subscribeToAutomationBot,
  getPromotionInfoForProduct,
};
