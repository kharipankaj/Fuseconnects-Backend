const cloudinary = require("cloudinary").v2;
const dotenv = require("dotenv");

dotenv.config();


if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error("❌ Cloudinary environment variables are missing!");
  module.exports = null;
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  console.log("✅ Cloudinary configured successfully");

  const deleteImage = async (publicId) => {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      console.log('Deleted from Cloudinary:', result);
      return result;
    } catch (err) {
      console.error('Error deleting from Cloudinary:', err);
      throw err;
    }
  };

  cloudinary.deleteImage = deleteImage;

  module.exports = cloudinary;
}
