// Load env vars FIRST before any other requires
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const mongoose = require("mongoose");
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
const Plan = require("./models/Plan");

const app = express();

// Define your whitelist for CORS
const whiteList = [
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


/// anonymous async function to find all systemselection with result not set 

// (async () => {
//   // Test query matching the blank filter logic
//   const blankQuery = {
//     systemId: '6927079fe504d7070a1e2cb3', // system 1
//     $or: [
//       { result: null },
//       { result: { $exists: false } },
//       { result: "" },
//     ],
//   };
//   const allBlankSelections = await SystemSelection.find(blankQuery).select("horse dateISO time");
//   console.log("All blank selections (all systems):", allBlankSelections);

//   // const selection = await SystemSelection.find({
//   //   horse:"Eupator"
//   // });
//   // console.log("selections", selection);
  
//   // Test with systemId filter (replace with actual systemId if needed)
//   // const systemId = "your-system-id-here";
//   // const blankQueryWithSystem = {
//   //   $and: [
//   //     { systemId },
//   //     {
//   //       $or: [
//   //         { result: null },
//   //         { result: { $exists: false } },
//   //         { result: "" },
//   //       ],
//   //     },
//   //   ],
//   // };
//   // const blankSelectionsForSystem = await SystemSelection.find(blankQueryWithSystem);
//   // console.log("Blank selections for system:", blankSelectionsForSystem.length);
// })();