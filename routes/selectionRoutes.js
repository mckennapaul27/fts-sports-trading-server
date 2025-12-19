const express = require("express");
const multer = require("multer");
const router = express.Router();
const { auth, admin } = require("../middleware/auth");
const {
  getSelections,
  getTodaySelections,
  getSelection,
  createSelection,
  createBulkSelections,
  uploadSelectionsFromCSV,
  uploadResultsFromCSV,
  updateSelection,
  updateSelectionResults,
  deleteSelection,
  markSelectionsViewed,
  deleteSelections,
} = require("../controllers/selectionController");

// Configure multer for CSV file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept CSV files
    if (
      file.mimetype === "text/csv" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.toLowerCase().endsWith(".csv")
    ) {
      cb(null, true);
    } else {
      req.fileValidationError = "Only CSV files are allowed";
      cb(null, false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// All routes require authentication
router.route("/").get(auth, getSelections);
router.route("/today").get(auth, getTodaySelections);
router.route("/mark-viewed").put(auth, markSelectionsViewed);

// Admin routes (require authentication + admin role)
// Note: Specific routes (like /bulk, /upload-csv, /:id/results) must come before /:id routes
router.route("/bulk").post(auth, admin, createBulkSelections);
router.route("/upload-csv").post(
  auth,
  admin,
  upload.single("csv"),
  (req, res, next) => {
    // Handle multer validation errors
    if (req.fileValidationError) {
      return res.status(400).json({
        success: false,
        error: req.fileValidationError,
      });
    }
    // Handle multer upload errors
    if (req.file === undefined) {
      return res.status(400).json({
        success: false,
        error: "CSV file is required",
      });
    }
    next();
  },
  uploadSelectionsFromCSV
);
router.route("/upload-results-csv").post(
  auth,
  admin,
  upload.single("csv"),
  (req, res, next) => {
    // Handle multer validation errors
    if (req.fileValidationError) {
      return res.status(400).json({
        success: false,
        error: req.fileValidationError,
      });
    }
    // Handle multer upload errors
    if (req.file === undefined) {
      return res.status(400).json({
        success: false,
        error: "CSV file is required",
      });
    }
    next();
  },
  uploadResultsFromCSV
);
router.route("/").post(auth, admin, createSelection);
router.route("/").delete(auth, admin, deleteSelections);
router.route("/:id/results").put(auth, admin, updateSelectionResults);
router.route("/:id").get(auth, getSelection);
router.route("/:id").put(auth, admin, updateSelection);
router.route("/:id").delete(auth, admin, deleteSelection);

module.exports = router;
