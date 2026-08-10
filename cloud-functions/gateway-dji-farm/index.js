const functions = require("@google-cloud/functions-framework");
const { createApp } = require("./src/app");

functions.http("gateway-dji-farm", createApp());
