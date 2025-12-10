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
} = require("../controllers/userController");
const { auth } = require("../middleware/auth");

// /api/users/billing
router.get("/billing", auth, getBillingDetails);

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

module.exports = router;
