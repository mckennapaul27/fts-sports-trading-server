const express = require("express");
const router = express.Router();
const {
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
  existingUserSubscribe,
  forgotPassword,
  resetPassword,
  subscribeToNewsletter,
} = require("../controllers/userController");
const { auth } = require("../middleware/auth");

// /api/users/billing
router.get("/billing", auth, getBillingDetails);

// /api/users/cancel-subscription
router.post("/cancel-subscription", auth, cancelSubscription);

// /api/users/resume-subscription
router.post("/resume-subscription", auth, resumeSubscription);

// /api/users/create-portal-session
router.post("/create-portal-session", auth, createPortalSession);

// /api/users/change-subscription
router.post("/change-subscription", auth, changeSubscription);

// /api/users/profile
router.get("/profile", auth, getUserProfile);
router.put("/profile", auth, updateUserProfile);

// /api/users/email-preferences
router.get("/email-preferences", auth, getEmailPreferences);
router.put("/email-preferences", auth, updateEmailPreferences);

// /api/users/change-password
router.put("/change-password", auth, changePassword);

// /api/users/existing-user-subscribe
router.post("/existing-user-subscribe", auth, existingUserSubscribe);

// /api/users/get
router.get("/", getUsers);
// /api/users/create
router.post("/", createUser);
// /api/users/get/:id
router.get("/:id", getUser);
// /api/users/update/:id
router.put("/:id", updateUser);
// /api/users/delete/:id
router.delete("/:id", deleteUser);
// /api/users/login
router.post("/login", loginUser);
// /api/users/register-and-subscribe
router.post("/register-and-subscribe", registerAndSubscribe);
// /api/users/forgot-password
router.post("/forgot-password", forgotPassword);
// /api/users/reset-password
router.post("/reset-password", resetPassword);
// /api/users/newsletter-subscribe
router.post("/newsletter-subscribe", subscribeToNewsletter);

module.exports = router;
