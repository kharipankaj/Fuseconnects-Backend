const jwt = require("jsonwebtoken");
const { hashToken } = require("../utils/crypto");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "superrefreshkey";

const isProd = process.env.NODE_ENV === "production";

async function jwtAuth(req, res, next) {
  let token = req.cookies?.accessToken;

  if (!token) {
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      const refreshToken = req.cookies?.refreshToken;
      if (!refreshToken) {
        return res.status(401).json({ message: "Unauthorized: No refresh token" });
      }

      try {
        const decodedRefresh = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);

        const user = await User.findById(decodedRefresh.id);
        if (!user) {
          return res.status(401).json({ message: "Unauthorized: User not found" });
        }

        const hashedRefresh = hashToken(refreshToken);
        if (!user.refreshTokens.includes(hashedRefresh)) {
          return res.status(401).json({ message: "Unauthorized: Refresh token revoked" });
        }

        const newAccessToken = jwt.sign(
          { id: user._id, username: user.username, role: user.role },
          JWT_SECRET,
          { expiresIn: "15m" }
        );

        const cookieOptions = {
          httpOnly: true,
          secure: isProd,
          sameSite: isProd ? 'None' : 'Lax',
          path: '/',
          maxAge: 15 * 60 * 1000,
        };
        res.cookie("accessToken", newAccessToken, cookieOptions);

        req.user = { id: user._id, username: user.username, role: user.role };
        return next();
      } catch (refreshErr) {
        return res.status(403).json({ message: "Unauthorized: Refresh token invalid" });
      }
    }

    return res.status(403).json({ message: "Unauthorized: Invalid or expired token" });
  }
}

module.exports = jwtAuth;
