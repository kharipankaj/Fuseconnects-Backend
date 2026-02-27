const multer = require("multer");
const cloudinary = require("../config/cloudinary.js");
const { Readable } = require("stream");

const storage = multer.memoryStorage();
const upload = multer({ storage });

const cloudinaryUpload = (fieldName) => {
  return [
    upload.single(fieldName),
    async (req, res, next) => {
      try {
        if (!req.file) {
          req.uploadedData = null;
          return next();
        }

        const isImage = req.file.mimetype.startsWith("image");
        const resourceType = isImage ? "image" : "video";

        const stream = cloudinary.uploader.upload_stream(
          {
            folder: "myUploads",
            resource_type: resourceType,
            eager: !isImage
              ? [
                  {
                    format: "mp4",
                    audio_codec: "aac", 
                    video_codec: "h264",
                  },
                ]
              : undefined,
          },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              return res
                .status(500)
                .json({ success: false, message: "Cloudinary upload failed" });
            }

            req.uploadedData = {
              userId: req.user?.id || req.user?._id,
              username: req.user?.username,
              url: result.secure_url,
              mediaType: isImage ? "image" : "video",
            };

            next();
          }
        );

        Readable.from(req.file.buffer).pipe(stream);
      } catch (err) {
        console.error("Upload middleware error:", err);
        res
          .status(500)
          .json({ success: false, message: "Upload middleware failed" });
      }
    },
  ];
};

module.exports = cloudinaryUpload;
