const { getStore } = require("@netlify/blobs");

function store() {
  return getStore("app-data");
}

function defaultState() {
  return { agenda: [], nextAgendaId: 1 };
}

async function readState() {
  const data = await store().get("state", { type: "json" });
  return data || defaultState();
}

async function writeState(state) {
  await store().set("state", JSON.stringify(state));
}

module.exports = { readState, writeState };
