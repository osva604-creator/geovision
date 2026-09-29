const crypto = require("crypto");
const { getHeader, setHeader } = require("../http");

function attachRequestId(req, res) {
  const incoming = getHeader(req, "x-request-id");
  const requestId = incoming || crypto.randomUUID();
  req.requestId = requestId;
  setHeader(res, "X-Request-Id", requestId);
  return requestId;
}

module.exports = {
  attachRequestId
};
