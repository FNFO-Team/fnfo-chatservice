module.exports = {
  validateConnectionPayload(handshake) {
    const auth = handshake.auth || {};

    if (!auth.username) {
      return { ok: false, reason: "missing username" };
    }

    const username = String(auth.username).trim().slice(0, 32);

    if (!username.length) {
      return { ok: false, reason: "invalid username" };
    }

    return { ok: true, user: { username } };
  }
};
