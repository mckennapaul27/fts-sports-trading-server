// Load env vars FIRST before any other requires
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const connectDB = require("./config/database");
const userRoutes = require("./routes/userRoutes");
const systemRoutes = require("./routes/systemRoutes");
const planRoutes = require("./routes/planRoutes");
const subscriptionRoutes = require("./routes/subscriptionRoutes");
const promotionRoutes = require("./routes/promotionRoutes");
const systemResultRoutes = require("./routes/systemResultRoutes");
const performanceRoutes = require("./routes/performanceRoutes");
const selectionRoutes = require("./routes/selectionRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const stripeWebhookController = require("./controllers/stripeWebhookController");

const System = require("./models/System");
const { syncAllSystems, syncSystemResults } = require("./services/syncService");
const SystemResult = require("./models/SystemResult");
const SystemSelection = require("./models/SystemSelection");

const app = express();

// Define your whitelist for CORS
const whiteList = [
  /bunkerdigital\.co.uk$/,
  /bunkerdigital\.com$/,
  /bunkerdigital\.com$/,
  /bunker-digital-fe-new-tw.vercel\.app$/,
  /fts-sports-trading-fe.vercel\.app$/,
  /fortissportstrading\.com$/,
];

if (process.env.NODE_ENV !== "production") {
  whiteList.push("http://localhost:3000");
  whiteList.push("http://localhost:3001");
  whiteList.push("http://localhost:3002");
  whiteList.push("http://localhost:5000");
}

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = whiteList.some((allowed) => {
        if (typeof allowed === "string") return origin === allowed;
        if (allowed instanceof RegExp) return allowed.test(origin);
        return false;
      });
      if (!isAllowed) {
        console.log("CORS blocked origin:", origin);
        console.log("Whitelist:", whiteList);
      }
      callback(null, isAllowed);
    },
    optionsSuccessStatus: 200,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
  })
);

// Stripe Webhook - MUST be before express.json() middleware
// Stripe needs the raw body buffer for signature verification
app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookController.handleStripeWebhook
);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Routes
app.use("/api/users", userRoutes);
app.use("/api/systems", systemRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/promotions", promotionRoutes);
app.use("/api/system-results", systemResultRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/selections", selectionRoutes);
app.use("/api/downloads", downloadRoutes);

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to FTS Sports Trading Server API" });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// Track if sync is currently running to prevent overlapping executions
let isSyncRunning = false;

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // // sync all systems
    // if (process.env.NODE_ENV === "production") {
    //   await syncAllSystems();
    // }

    // // await syncAllSystems();

    // // await syncSystemResults("6927079fe504d7070a1e2cb3");

    // // one time function to deleta all system results
    // // await SystemResult.deleteMany({});

    // // Set up cron job to sync Google Sheets every 5 minutes
    // const cronTime =
    //   process.env.NODE_ENV === "production" ? "*/5 * * * *" : "*/55 * * * *";
    // // Cron expression: "*/5 * * * *" means every 5 minutes
    // // Set scheduled: true to prevent overlapping executions
    // cron.schedule(
    //   cronTime,
    //   async () => {
    //     // Skip if sync is already running
    //     if (isSyncRunning) {
    //       console.log("⏭️  Sync already in progress, skipping this execution");
    //       return;
    //     }

    //     isSyncRunning = true;
    //     const startTime = Date.now();

    //     console.log("🔄 Running scheduled sync from Google Sheets...");
    //     try {
    //       await syncAllSystems();
    //       const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    //       console.log(`✅ Sync completed in ${duration} seconds`);
    //     } catch (error) {
    //       console.error("❌ Error in scheduled sync:", error.message);
    //     } finally {
    //       isSyncRunning = false;
    //     }
    //   },
    //   {
    //     scheduled: true,
    //     timezone: "UTC",
    //   }
    // );

    // console.log("✅ Cron job scheduled: Google Sheets sync every 55 minutes");

    // // Run initial sync on server start (optional)
    // if (process.env.RUN_INITIAL_SYNC === "true") {
    //   console.log("🔄 Running initial sync on server start...");
    //   try {
    //     await syncAllSystems();
    //   } catch (error) {
    //     console.error("❌ Error in initial sync:", error.message);
    //   }
    // }

    const PORT = process.env.PORT || 5001;

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

// // // One-time function to add initial system
// const initializeSystem = async () => {
//   try {
//     const existingSystem = await System.findOne({ slug: "system-3" });
//     if (existingSystem) {
//       console.log("System 'system-2' already exists, skipping initialization");
//       return;
//     }

//     const system = await System.create({
//       name: "System 3",
//       slug: "system-3",
//       isActive: true,
//       sheets: {
//         // don't add selections for now
//         selections: {
//           spreadsheetId: "1JNnNoLjuCQvu66NU-LulDdNV9NGIcSHI1LAaYoU98nk",
//           range: "System3", // Placeholder - update with actual selections range
//         },
//         results: {
//           spreadsheetId: "1JNnNoLjuCQvu66NU-LulDdNV9NGIcSHI1LAaYoU98nk",
//           range: "System3",
//         },
//       },
//     });

//     console.log("✅ System 'system-3' created successfully:", system);
//   } catch (error) {
//     console.error("❌ Error initializing system:", error.message);
//   }
// };

// initializeSystem();

// async function to find system selection with horse called Birdman Bob
// (async () => {
//   const selections = await SystemSelection.deleteOne({
//     horse: "Avada Kedavra",
//   });
//   console.log("selections", selections);
// })();

// ASYNC FUNCT TO FIND ALL SYSTEMSELECTIONS WITH DATEISO OF 2025-12-19
// const findSystemSelectionsWithDateISO = async () => {
//   const selections = await SystemSelection.deleteMany({
//     dateISO: "2025-12-19",
//   });
//   console.log("selections", selections.length);
// };

// findSystemSelectionsWithDateISO();

// One-time function to clean up place market data
// 1. Change any "PLACED" results to "LOST"
// 2. Remove placeBsp, placePL, and runningPlacePL from all documents
const cleanupPlaceMarketData = async () => {
  try {
    await connectDB();
    console.log("🔄 Starting place market data cleanup...");

    // Step 1: Update all "PLACED" results to "LOST" (case-insensitive)
    const placedUpdateResult = await SystemSelection.updateMany(
      { result: { $regex: /^PLACED$/i } },
      { $set: { result: "LOST" } }
    );
    console.log(
      `✅ Updated ${placedUpdateResult.modifiedCount} selections from PLACED to LOST`
    );

    // Step 2: Remove placeBsp, placePL, and runningPlacePL from all documents
    const placeFieldsUpdateResult = await SystemSelection.updateMany(
      {
        $or: [
          { placeBsp: { $exists: true, $ne: null } },
          { placePL: { $exists: true, $ne: null } },
          { runningPlacePL: { $exists: true, $ne: null } },
        ],
      },
      {
        $unset: {
          placeBsp: "",
          placePL: "",
          runningPlacePL: "",
        },
      }
    );
    console.log(
      `✅ Removed place fields from ${placeFieldsUpdateResult.modifiedCount} selections`
    );

    console.log("✅ Place market data cleanup completed successfully");
  } catch (error) {
    console.error("❌ Error cleaning up place market data:", error.message);
  }
};

// Uncomment the line below to run the cleanup function
// cleanupPlaceMarketData();
