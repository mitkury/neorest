#!/bin/bash

# Test Suite Multiple Run Script
# This script runs the test suite multiple times to catch intermittent failures

set -e

echo "🧪 Running test suite multiple times to catch intermittent failures..."
echo "=================================================="

TOTAL_RUNS=6
SUCCESS_COUNT=0
FAILURE_COUNT=0
START_TIME=$(date +%s)

for i in $(seq 1 $TOTAL_RUNS); do
    echo ""
    echo "🔄 Run $i/$TOTAL_RUNS"
    echo "----------------------------------------"
    
    RUN_START=$(date +%s)
    
    if npm test > "test-run-$i.log" 2>&1; then
        echo "✅ Run $i: PASSED"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "❌ Run $i: FAILED"
        FAILURE_COUNT=$((FAILURE_COUNT + 1))
        echo "📄 Log saved to: test-run-$i.log"
    fi
    
    RUN_END=$(date +%s)
    RUN_DURATION=$((RUN_END - RUN_START))
    echo "⏱️  Duration: ${RUN_DURATION}s"
done

END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo ""
echo "=================================================="
echo "📊 FINAL RESULTS"
echo "=================================================="
echo "Total Runs: $TOTAL_RUNS"
echo "✅ Successful: $SUCCESS_COUNT"
echo "❌ Failed: $FAILURE_COUNT"
echo "📈 Success Rate: $((SUCCESS_COUNT * 100 / TOTAL_RUNS))%"
echo "⏱️  Total Duration: ${TOTAL_DURATION}s"
echo ""

if [ $FAILURE_COUNT -eq 0 ]; then
    echo "🎉 All tests passed consistently!"
    exit 0
else
    echo "⚠️  Found $FAILURE_COUNT intermittent failures"
    echo "📄 Check individual logs for details:"
    for i in $(seq 1 $TOTAL_RUNS); do
        if [ -f "test-run-$i.log" ]; then
            echo "   - test-run-$i.log"
        fi
    done
    exit 1
fi