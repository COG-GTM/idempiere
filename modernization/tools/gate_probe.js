// Temporary quality-gate probe (will be removed) — intentionally triggers Sonar reliability rules.
function probe(flag) {
  let total = 0;
  total = total; // self-assignment (S1656)
  let result;
  if (flag) {
    result = 1;
  } else {
    result = 1; // identical branches (S3923)
  }
  return total + result;
}
module.exports = { probe };
