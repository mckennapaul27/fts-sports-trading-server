const express = require("express");
const dotenv = require("dotenv");
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
const System = require("./models/System");
const { syncAllSystems, syncSystemResults } = require("./services/syncService");
const SystemResult = require("./models/SystemResult");

// Load env vars
dotenv.config();

const app = express();

// Middleware
app.use(cors());
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

    // await syncSystemResults("6927079fe504d7070a1e2cb3");

    // one time function to deleta all system results
    // await SystemResult.deleteMany({});

    // Set up cron job to sync Google Sheets every 5 minutes
    // Cron expression: "*/5 * * * *" means every 5 minutes
    // Set scheduled: true to prevent overlapping executions
    cron.schedule(
      "*/55 * * * *",
      async () => {
        // Skip if sync is already running
        if (isSyncRunning) {
          console.log("⏭️  Sync already in progress, skipping this execution");
          return;
        }

        isSyncRunning = true;
        const startTime = Date.now();

        console.log("🔄 Running scheduled sync from Google Sheets...");
        try {
          await syncAllSystems();
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          console.log(`✅ Sync completed in ${duration} seconds`);
        } catch (error) {
          console.error("❌ Error in scheduled sync:", error.message);
        } finally {
          isSyncRunning = false;
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    console.log("✅ Cron job scheduled: Google Sheets sync every 55 minutes");

    // Run initial sync on server start (optional)
    if (process.env.RUN_INITIAL_SYNC === "true") {
      console.log("🔄 Running initial sync on server start...");
      try {
        await syncAllSystems();
      } catch (error) {
        console.error("❌ Error in initial sync:", error.message);
      }
    }

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
