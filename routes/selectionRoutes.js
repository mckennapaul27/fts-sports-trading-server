const express = require("express");
const router = express.Router();
const { auth, admin } = require("../middleware/auth");
const {
  getSelections,
  getTodaySelections,
  getSelection,
  createSelection,
  createBulkSelections,
  updateSelection,
  updateSelectionResults,
  deleteSelection,
  markSelectionsViewed,
  deleteSelections,
} = require("../controllers/selectionController");

// All routes require authentication
router.route("/").get(auth, getSelections);
router.route("/today").get(auth, getTodaySelections);
router.route("/mark-viewed").put(auth, markSelectionsViewed);

// Admin routes (require authentication + admin role)
// Note: Specific routes (like /bulk, /:id/results) must come before /:id routes
router.route("/bulk").post(auth, admin, createBulkSelections);
router.route("/").post(auth, admin, createSelection);
router.route("/").delete(auth, admin, deleteSelections);
router.route("/:id/results").put(auth, admin, updateSelectionResults);
router.route("/:id").get(auth, getSelection);
router.route("/:id").put(auth, admin, updateSelection);
router.route("/:id").delete(auth, admin, deleteSelection);

module.exports = router;
