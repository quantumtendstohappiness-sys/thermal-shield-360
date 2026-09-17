/**
 * Thermal Shield 360
 * Automated QC Test Runner
 *
 * Tests the QC engine using controlled synthetic records.
 */

const { validateThermalObservation } = require("./qc");
const testData = require("./test-records.json");

let passed = 0;
let failed = 0;

console.log("========================================");
console.log("THERMAL SHIELD 360 - QC TEST SUITE");
console.log("========================================");

for (const test of testData.tests) {

  const result = validateThermalObservation(test.record);

  const actual = result.overall_status;
  const expected = test.expected_result;

  const success = actual === expected;

  if (success) {
    passed++;
    console.log(`PASS: ${test.id} - ${test.name}`);
    console.log(`      Expected: ${expected}`);
    console.log(`      Actual:   ${actual}`);
  } else {
    failed++;
    console.log(`FAIL: ${test.id} - ${test.name}`);
    console.log(`      Expected: ${expected}`);
    console.log(`      Actual:   ${actual}`);
  }

  console.log("----------------------------------------");
}

console.log("");
console.log("QC TEST SUMMARY");
console.log("========================================");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${testData.tests.length}`);
console.log("========================================");

if (failed > 0) {
  console.error("QC TEST SUITE FAILED");
  process.exit(1);
}

console.log("QC TEST SUITE PASSED");
process.exit(0);
