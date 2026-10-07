// Archived results contain copies of talks in several leaderboard arrays.
function stripTalkDetails(value) {
  if (!value || typeof value !== "object") return 0;
  let removed = 0;
  for (const [key, child] of Object.entries(value)) {
    if (["talks", "allTalks", "leaderboard"].includes(key) && Array.isArray(child)) {
      for (const talk of child) {
        if (!talk || typeof talk !== "object") continue;
        for (const field of ["speaker", "description"]) {
          if (Object.hasOwn(talk, field)) {
            delete talk[field];
            removed++;
          }
        }
      }
    }
    removed += stripTalkDetails(child);
  }
  return removed;
}

module.exports = { stripTalkDetails };
