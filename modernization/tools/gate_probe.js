// Temporary quality-gate probe (will be removed) — intentionally triggers Sonar reliability rules.
function probe(items) {
  let total = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i] == null) {
      total += items[i].value; // null dereference (bug)
    }
    total += items[i].value;
  }
  return total;
}
module.exports = { probe };
