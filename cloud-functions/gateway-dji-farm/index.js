const functions = require("@google-cloud/functions-framework");
const axios = require("axios");
const FormData = require("form-data");

const DJI_LOGIN_URL = process.env.DJI_LOGIN_URL || "https://uoms.dji.com/api/v1/login";
const DJI_UPLOAD_URL = process.env.DJI_UPLOAD_URL || "https://uoms.dji.com/api/v1/mission-upload";
const MAX_KMZ_BYTES = Number(process.env.MAX_KMZ_BYTES || 25 * 1024 * 1024);

function normalizarNombreMision(nombreRaw) {
  return (
    String(nombreRaw || "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "geovision-mision"
  );
}

function obtenerBufferKMZ(req) {
  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody;
  }
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    return req.body;
  }
  if (req.body instanceof Uint8Array && req.body.length > 0) {
    return Buffer.from(req.body);
  }
  if (typeof req.body === "string" && req.body.length > 0) {
    return Buffer.from(req.body);
  }
  return Buffer.alloc(0);
}

function obtenerAccessToken(djiAuthResponse) {
  return (
    djiAuthResponse?.data?.data?.access_token ||
    djiAuthResponse?.data?.access_token ||
    djiAuthResponse?.data?.token ||
    null
  );
}

/**
 * Gateway GeoVision -> DJI Cloud
 * Region sugerida: southamerica-east1
 */
functions.http("gateway-dji-farm", async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Mission-Name, X-Mission-Date"
  );
  res.set("Access-Control-Max-Age", "3600");

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Metodo no permitido" });
  }

  try {
    const djiKey = process.env.DJI_APP_KEY;
    const djiSecret = process.env.DJI_APP_SECRET;

    if (!djiKey || !djiSecret) {
      return res.status(500).json({
        success: false,
        error: "Faltan variables de entorno DJI_APP_KEY / DJI_APP_SECRET"
      });
    }

    const missionName = normalizarNombreMision(req.get("X-Mission-Name"));
    const missionDate = req.get("X-Mission-Date") || new Date().toISOString();
    const kmzBuffer = obtenerBufferKMZ(req);

    if (!kmzBuffer.length) {
      return res.status(400).json({
        success: false,
        error: "No se recibio archivo KMZ en el body"
      });
    }

    if (kmzBuffer.length > MAX_KMZ_BYTES) {
      return res.status(413).json({
        success: false,
        error: `El KMZ excede el limite de ${MAX_KMZ_BYTES} bytes`
      });
    }

    const djiAuthResponse = await axios.post(
      DJI_LOGIN_URL,
      {
        app_key: djiKey,
        app_secret: djiSecret
      },
      { timeout: 15000 }
    );

    const accessToken = obtenerAccessToken(djiAuthResponse);
    if (!accessToken) {
      return res.status(502).json({
        success: false,
        error: "DJI no devolvio access_token",
        detalle: djiAuthResponse?.data || null
      });
    }

    const form = new FormData();
    form.append("file", kmzBuffer, {
      filename: `${missionName}.kmz`,
      contentType: "application/vnd.google-earth.kmz"
    });

    const djiUploadResponse = await axios.post(DJI_UPLOAD_URL, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`
      },
      maxBodyLength: Infinity,
      timeout: 30000
    });

    const djiData = djiUploadResponse?.data || null;

    return res.status(200).json({
      success: true,
      message: "Mision despachada al dron con exito",
      mission_name: missionName,
      mission_date: missionDate,
      dji_ref: djiData?.data?.job_id || djiData?.data?.id || null,
      dji_response: djiData
    });
  } catch (error) {
    console.error("Error en el proceso DJI:", error?.response?.data || error?.message);
    return res.status(500).json({
      success: false,
      error: "Falla en el despacho a DJI",
      detalle: error?.response?.data || error?.message || "Error desconocido"
    });
  }
});
