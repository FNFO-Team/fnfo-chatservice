/**
 * Servicio para comunicarse con User Profile Service
 * Obtiene información de usuarios (nombre, país, etc.)
 */

const config = require("./config");

// Cache en memoria para evitar llamadas repetidas
const profileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene el perfil de un usuario por su Firebase UID
 * @param {string} firebaseUid 
 * @param {string} [authToken] 
 * @returns {Promise<Object|null>}
 */
async function getProfileByFirebaseUid(firebaseUid, authToken = null) {
  const cached = profileCache.get(firebaseUid);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.profile;
  }

  try {
    const headers = {
      "Content-Type": "application/json"
    };

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(
      `${config.USER_PROFILE_SERVICE_URL}/by-firebase-uid/${firebaseUid}`,
      { headers }
    );

    if (!response.ok) {
      console.warn(`[PROFILE] Usuario no encontrado: ${firebaseUid}`);
      return null;
    }

    const profile = await response.json();

    profileCache.set(firebaseUid, {
      profile,
      timestamp: Date.now()
    });

    return profile;
  } catch (error) {
    console.error(`[PROFILE] Error obteniendo perfil:`, error.message);
    return null;
  }
}

/**
 * Obtiene el nombre de display de un usuario
 * @param {string} firebaseUid - UID de Firebase
 * @param {string} [fallback] - Nombre por defecto si no se encuentra
 * @returns {Promise<string>}
 */
async function getDisplayName(firebaseUid, fallback = "Anónimo") {
  const profile = await getProfileByFirebaseUid(firebaseUid);
  return profile?.name || fallback;
}

/**
 * Obtiene perfiles de múltiples usuarios
 * @param {string[]} firebaseUids - Lista de UIDs
 * @returns {Promise<Map<string, Object>>}
 */
async function getMultipleProfiles(firebaseUids) {
  const results = new Map();

  await Promise.all(
    firebaseUids.map(async (uid) => {
      const profile = await getProfileByFirebaseUid(uid);
      if (profile) {
        results.set(uid, profile);
      }
    })
  );

  return results;
}

/**
 * Limpia la cache de un usuario específico
 * @param {string} firebaseUid
 */
function invalidateCache(firebaseUid) {
  profileCache.delete(firebaseUid);
}

/**
 * Limpia toda la cache
 */
function clearCache() {
  profileCache.clear();
}

module.exports = {
  getProfileByFirebaseUid,
  getDisplayName,
  getMultipleProfiles,
  invalidateCache,
  clearCache
};