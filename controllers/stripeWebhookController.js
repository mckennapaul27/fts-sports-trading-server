const StripeSubscription = require("../models/StripeSubscription");
const WebHookEvent = require("../models/WebHookEvent");
const User = require("../models/User");
const System = require("../models/System");
const { Resend } = require("resend");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Recalculate and update user's activeSystemIds based on all active subscriptions
 * This ensures activeSystemIds is accurate even if user has multiple subscriptions
 */
async function updateUserActiveSystemIds(userId) {
  try {
    // Find all active subscriptions for the user
    const activeSubscriptions = await StripeSubscription.find({
      userId,
      status: { $in: ["active", "trialing"] },
    });

    if (activeSubscriptions.length === 0) {
      // No active subscriptions, clear activeSystemIds
      const user = await User.findById(userId);
      if (user) {
        user.activeSystemIds = [];
        await user.save();
        console.log(
          `User ${userId} activeSystemIds cleared (no active subscriptions)`
        );
      }
      return;
    }

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
        `User ${userId} activeSystemIds recalculated:`,
        user.activeSystemIds
      );
    }
  } catch (error) {
    console.error(`Error updating activeSystemIds for user ${userId}:`, error);
    throw error;
  }
}

const handleCheckoutSessionCompleted = async (session) => {
  const subscriptionId = session.subscription;

  if (!subscriptionId) {
    console.log(
      "⚠️  No subscription ID in session - this might be a one-time payment"
    );
    return;
  }

  console.log(`🔍 Retrieving subscription: ${subscriptionId}`);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  console.log("📋 Subscription retrieved:");
  console.log("  - ID:", subscription.id);
  console.log("  - Status:", subscription.status);
  console.log("  - Metadata:", subscription.metadata);

  // Get dates from subscription items (they're nested, not at root level)
  const subscriptionItem = subscription.items.data[0];
  const currentPeriodStart = subscriptionItem?.current_period_start;
  const currentPeriodEnd = subscriptionItem?.current_period_end;

  console.log("  - Dates from items.data[0]:");
  console.log("    - current_period_start:", currentPeriodStart);
  console.log("    - current_period_end:", currentPeriodEnd);

  const { userId, productId, systemSlugs } = subscription.metadata;

  if (!userId || !productId || !systemSlugs) {
    console.error(
      "CRITICAL: User ID or Product ID or System Slugs not found in subscription metadata.",
      subscription
    );
    throw new Error(
      "User ID or Product ID or System Slugs not found in subscription metadata."
    );
  }

  const existingSubscription = await StripeSubscription.findOne({
    stripeSubscriptionId: subscription.id,
  });
  if (existingSubscription) {
    console.log(
      `Subscription ${subscription.id} already processed. Skipping creation.`
    );
    return;
  }

  // Only set dates if they exist, otherwise let them be undefined (model allows it)
  const subscriptionData = {
    userId: userId,
    stripeSubscriptionId: subscription.id,
    plan: subscriptionItem?.plan.id,
    productId: productId,
    status: subscription.status,
    metadata: {
      userId: userId,
      productId: productId,
      systemSlugs: systemSlugs,
    },
  };

  // Only add dates if they exist
  if (currentPeriodStart) {
    subscriptionData.currentPeriodStart = new Date(currentPeriodStart * 1000);
  }
  if (currentPeriodEnd) {
    subscriptionData.currentPeriodEnd = new Date(currentPeriodEnd * 1000);
  }

  await StripeSubscription.create(subscriptionData);

  console.log(`Subscription created for user: ${userId}`);

  // Update user's active system IDs by recalculating from all active subscriptions
  // This ensures we aggregate all subscriptions if user has multiple
  try {
    await updateUserActiveSystemIds(userId);
  } catch (error) {
    console.error(
      "Error updating activeSystemIds in handleCheckoutSessionCompleted:",
      error
    );
    // Don't throw - log the error but don't fail the webhook
  }
};

const handleSubscriptionUpdated = async (subscription) => {
  try {
    // Check if subscription exists in database
    const existingSubscription = await StripeSubscription.findOne({
      stripeSubscriptionId: subscription.id,
    });

    if (!existingSubscription) {
      console.log(
        `⚠️  Subscription ${subscription.id} not found in database. Skipping update.`
      );
      return;
    }

    // Build update object with only fields that exist
    const updateData = {
      status: subscription.status,
    };

    // Update plan and productId if available
    if (subscription.items?.data?.[0]?.plan) {
      updateData.plan = subscription.items.data[0].plan.id;
      updateData.productId = subscription.items.data[0].plan.product;
    }

    // Update current period dates if available (these are at root level, not in items)
    if (subscription.current_period_start) {
      const date = new Date(subscription.current_period_start * 1000);
      if (!isNaN(date.getTime())) {
        updateData.currentPeriodStart = date;
      }
    }
    if (subscription.current_period_end) {
      const date = new Date(subscription.current_period_end * 1000);
      if (!isNaN(date.getTime())) {
        updateData.currentPeriodEnd = date;
      }
    }

    // Update cancellation fields if available
    if (subscription.cancel_at) {
      const date = new Date(subscription.cancel_at * 1000);
      if (!isNaN(date.getTime())) {
        updateData.cancelAt = date;
      }
    }
    if (subscription.canceled_at) {
      const date = new Date(subscription.canceled_at * 1000);
      if (!isNaN(date.getTime())) {
        updateData.canceledAt = date;
      }
    }
    if (subscription.cancel_at_period_end !== undefined) {
      updateData.cancelAtPeriodEnd = subscription.cancel_at_period_end;
    }

    const updatedSubscription = await StripeSubscription.findOneAndUpdate(
      { stripeSubscriptionId: subscription.id },
      updateData,
      { new: true }
    );
    console.log(`✅ Subscription updated: ${subscription.id}`);

    // Update user's activeSystemIds if systemSlugs in metadata changed
    // Check if metadata.systemSlugs exists and has changed
    if (
      subscription.metadata &&
      subscription.metadata.systemSlugs &&
      updatedSubscription
    ) {
      try {
        const userId = updatedSubscription.userId;
        const systemSlugs = subscription.metadata.systemSlugs;

        // Parse systemSlugs (it might be a JSON string or already an array)
        let parsedSystemSlugs;
        try {
          parsedSystemSlugs = JSON.parse(systemSlugs);
        } catch (e) {
          // If parsing fails, assume it's already an array or handle as string
          parsedSystemSlugs = Array.isArray(systemSlugs)
            ? systemSlugs
            : [systemSlugs];
        }

        if (Array.isArray(parsedSystemSlugs) && parsedSystemSlugs.length > 0) {
          // Use the helper function to recalculate activeSystemIds
          // This ensures we aggregate all active subscriptions if user has multiple
          await updateUserActiveSystemIds(userId);
        } else {
          // If no system slugs, recalculate anyway to clear if needed
          await updateUserActiveSystemIds(userId);
        }
      } catch (error) {
        console.error(
          "Error updating user activeSystemIds in handleSubscriptionUpdated:",
          error
        );
        // Don't throw - log the error but don't fail the webhook
      }
    }
  } catch (error) {
    console.error(
      `❌ Error updating subscription ${JSON.stringify(
        subscription,
        null,
        2
      )}:`,
      error.message
    );
    throw error;
  }
};

const handleSubscriptionDeleted = async (subscription) => {
  const updatedSubscription = await StripeSubscription.findOneAndUpdate(
    { stripeSubscriptionId: subscription.id },
    { status: "canceled" },
    { new: true }
  );
  console.log(`Subscription canceled: ${subscription.id}`);

  // Recalculate user's activeSystemIds based on remaining active subscriptions
  if (updatedSubscription && updatedSubscription.userId) {
    try {
      await updateUserActiveSystemIds(updatedSubscription.userId);
    } catch (error) {
      console.error(
        `Error updating activeSystemIds after subscription deletion:`,
        error
      );
      // Don't throw - log the error but don't fail the webhook
    }
  }
};

const handleInvoicePaymentFailed = async (invoice) => {
  try {
    // 1. Find the subscription in our database using the ID from the invoice
    const subscription = await StripeSubscription.findOne({
      stripeSubscriptionId: invoice.subscription,
    });

    if (!subscription) {
      console.error(
        `Webhook Error: Received invoice.payment_failed for a subscription not found in DB: ${invoice.subscription}`
      );
      return;
    }

    // 2. Find the user associated with this subscription
    const user = await User.findById(subscription.userId);

    if (!user) {
      console.error(
        `Webhook Error: User not found for subscription ID: ${invoice.subscription}`
      );
      return;
    }

    // 3. Send the email notification using Resend
    await resend.emails.send({
      from: "Bunker Digital <mail@bunkerdigital.co.uk>",
      to: user.email,
      subject: "Action Required: Your Subscription Payment Failed",
      html: `
        <h1>Payment Issue with Your Bunker Digital Subscription</h1>
        <p>Hi ${user.firstName || "there"},</p>
        <p>We're writing to let you know that the latest payment for your subscription failed. This can happen for a number of reasons, such as an expired card or insufficient funds.</p>
        <p>To ensure your service continues without interruption, please update your payment details as soon as possible.</p>
        <p>You can do this by logging into your account and visiting the billing management page:</p>
        <p><a href="https://www.bunkerdigital.co.uk/login"><strong>Log in to Update Payment Method</strong></a></p>
        <p>Once you've updated your details, Stripe will automatically retry the payment.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <p>Thanks,<br>Paul</p>
        <p>Bunker Digital</p>
      `,
    });

    console.log(`Payment failed email sent to: ${user.email}`);
  } catch (error) {
    console.error("Error in handleInvoicePaymentFailed:", error);
  }
};

exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed.`, err.message);
    console.error(
      `Webhook secret used: ${
        process.env.STRIPE_WEBHOOK_SECRET ? "SET" : "NOT SET"
      }`
    );
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Prevent processing duplicate events
  const existingEvent = await WebHookEvent.findOne({ stripeEventId: event.id });
  if (existingEvent) {
    console.log(`Webhook event ${event.id} already processed.`);
    return res.json({ received: true });
  }

  // Save the event to the database
  await WebHookEvent.create({
    stripeEventId: event.id,
    type: event.type,
    payload: event.data.object,
  });

  console.log("event", event.type);

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_failed":
        // Only handle for subscriptions
        if (event.data.object.subscription) {
          await handleInvoicePaymentFailed(event.data.object);
        }
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (error) {
    console.error(`Error handling webhook event ${event}:`, error);
    // Optionally, you could update the WebHookEvent record to mark it as failed
    return res.status(500).json({ error: "Webhook handler failed." });
  }

  res.json({ received: true });
};
