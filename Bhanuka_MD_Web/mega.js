const mega = require("mega");

// Authentication details (replace with your actual credentials)
const auth = {
  email: "Bhanukamd123@gmail.com",
  password: "BhanukaMD123@",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
             "(KHTML, like Gecko) Chrome/89.0.4389.82 Safari/537.36"
};

/**
 * Uploads a file to MEGA storage.
 * @param {WritableStream} stream - The input stream for the file.
 * @param {string} filename - The name to save the file as.
 * @returns {Promise<string>} - Resolves with the public file link.
 */
function upload(stream, filename) {
  return new Promise((resolve, reject) => {
    const storage = new mega.Storage(auth);

    storage.on("ready", () => {
      console.log("Logged into MEGA. Uploading:", filename);

      const uploader = storage.upload({
        name: filename,
        allowUploadBuffering: true
      });

      uploader.on("complete", file => {
        file.link((err, link) => {
          if (err) return reject(err);
          storage.close();
          resolve(link);
        });
      });

      uploader.on("error", reject);

      // Pipe the incoming stream into the uploader
      stream.pipe(uploader);
    });

    storage.on("error", reject);
  });
}

module.exports = { upload };
