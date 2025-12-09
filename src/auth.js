/**
 * Autenticación con Firebase Admin SDK
 * Valida tokens JWT de Firebase y obtiene información del usuario
 */

const admin = require("firebase-admin");
const config = require("./config");

// Inicializar Firebase Admin 
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log("[AUTH] Firebase Admin inicializado correctamente");
  } catch (error) {
    console.error("[AUTH] Error inicializando Firebase Admin:", error.message);
    console.warn("[AUTH] Continuando en modo desarrollo sin Firebase");
  }
}

/**
 * Valida el payload de conexión del socket
 * Acepta token de Firebase O username para desarrollo
 */
async function validateConnectionPayload(handshake) {
  const auth = handshake.auth || {};

  // Modo producción: usar token de Firebase
  if (auth.token) {
    try {
      const decodedToken = await admin.auth().verifyIdToken(auth.token);
      
      return {
        ok: true,
        user: {
          oduserId: decodedToken.uid,      
          email: decodedToken.email,
          // El nombre se obtendrá del User Profile Service
        }
      };
    } catch (error) {
      console.error("[AUTH] Token inválido:", error.message);
      return { ok: false, reason: "invalid token" };
    }
  }

  if (process.env.NODE_ENV !== "production") {
    if (auth.oduserId && auth.username) {
      console.warn("[AUTH] Modo desarrollo: usando oduserId/username sin verificar");
      return {
        ok: true,
        user: {
          oduserId: auth.oduserId,
          username: auth.username,
          isDev: true
        }
      };
    }
    
    if (auth.username) {
      console.warn("[AUTH] Modo desarrollo legacy: usando solo username");
      return {
        ok: true,
        user: {
          oduserId: `dev_${auth.username}`,
          username: auth.username,
          isDev: true
        }
      };
    }
  }

  return { ok: false, reason: "authentication required (token or oduserId+username)" };
}

/**
 * Verifica un token de Firebase (HTTP)
 */
async function verifyToken(token) {
  if (!token) {
    return { ok: false, reason: "no token provided" };
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return {
      ok: true,
      user: {
        oduserId: decodedToken.uid,
        email: decodedToken.email
      }
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = {
  validateConnectionPayload,
  verifyToken,
  firebaseAdmin: admin
};