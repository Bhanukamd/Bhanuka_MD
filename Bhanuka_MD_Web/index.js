// index.js
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8000;

// Increase max listeners (if needed)
require("events").EventEmitter.defaultMaxListeners = 500;

// Import routes
const codeRouter = require("./pair");

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use("/code", codeRouter);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "pair.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

module.exports = app;
