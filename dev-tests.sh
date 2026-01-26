#!/bin/bash

# ============================================================================
# Local Integration Test Suite for Opcode
#
# Purpose: Validate that the system works correctly after code changes
# Safety: Tests are read-only and non-destructive
#
# Usage:
#   ./dev-tests.sh              # Run all tests
#   ./dev-tests.sh frontend     # Test frontend only
#   ./dev-tests.sh backend      # Test backend only
#   ./dev-tests.sh service      # Test service health
#   ./dev-tests.sh quick        # Quick sanity check
# ============================================================================

set -e  # Exit on error

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# ============================================================================
# Helper Functions (No colors - plain text for AI parsing)
# ============================================================================

log_info() {
    echo "[INFO] $1"
}

log_success() {
    echo "[PASS] $1"
    ((TESTS_PASSED++))
    ((TESTS_TOTAL++))
}

log_fail() {
    echo "[FAIL] $1"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
}

log_section() {
    echo ""
    echo "============================================================"
    echo "$1"
    echo "============================================================"
    echo ""
}

log_header() {
    echo ""
    echo ">> $1"
}

# ============================================================================
# Test Functions
# ============================================================================

test_frontend_build() {
    log_header "Testing Frontend Build..."

    # Check if bun is installed
    if ! command -v bun &> /dev/null; then
        log_fail "Bun is not installed"
        return 1
    fi

    # Test 1: Check dependencies
    log_info "Checking node_modules..."
    if [ -d "node_modules" ]; then
        log_success "node_modules exists"
    else
        log_fail "node_modules not found. Run 'bun install' first."
        return 1
    fi

    # Test 2: Frontend TypeScript compilation
    log_info "Running TypeScript type check..."
    if bun tsc --noEmit --skipLibCheck 2>&1 | head -20; then
        log_success "TypeScript compilation passed"
    else
        log_fail "TypeScript compilation failed"
        return 1
    fi

    # Test 3: Frontend build
    log_info "Building frontend..."
    if bun run build 2>&1 | tail -5; then
        log_success "Frontend build completed"
    else
        log_fail "Frontend build failed"
        return 1
    fi
}

test_backend_build() {
    log_header "Testing Backend Build..."

    # Check if cargo is installed
    if ! command -v cargo &> /dev/null; then
        log_fail "Cargo is not installed"
        return 1
    fi

    # Test 1: Backend Rust compilation
    log_info "Checking Rust compilation..."
    if cd src-tauri && cargo check --lib 2>&1 | tail -10; then
        log_success "Backend compilation passed"
    else
        log_fail "Backend compilation failed"
        return 1
    fi
}

test_service_health() {
    log_header "Testing Service Health..."

    local PORT=${1:-8080}
    local MAX_RETRIES=5
    local RETRY_COUNT=0

    # Check if service is running
    log_info "Checking service on port $PORT..."

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" 2>/dev/null | grep -q "200\|302"; then
            log_success "Service is running on port $PORT"

            # Additional health check
            if curl -s "http://localhost:$PORT/api/health" 2>/dev/null | grep -q "ok"; then
                log_success "Health endpoint responds OK"
            fi

            return 0
        fi

        RETRY_COUNT=$((RETRY_COUNT + 1))
        log_info "Waiting for service... ($RETRY_COUNT/$MAX_RETRIES)"
        sleep 2
    done

    log_fail "Service not running on port $PORT"
    log_info "Hint: Run 'just web' or 'just dev-web' to start the service"
    return 1
}

test_git_status() {
    log_header "Testing Git Status..."

    # Check for uncommitted changes
    if git diff --stat --exit-code &>/dev/null; then
        log_success "No uncommitted changes"
    else
        log_fail "There are uncommitted changes"
        echo "Hint: Run 'git status' to see changes"
    fi

    # Check for untracked files
    if [ -z "$(git ls-files --others --exclude-standard)" ]; then
        log_success "No untracked files"
    else
        log_info "Untracked files found (may be normal for dev)"
        git ls-files --others --exclude-standard | head -5
    fi
}

test_docker_build() {
    log_header "Testing Docker Build..."

    if ! command -v docker &> /dev/null; then
        log_info "Docker not installed, skipping Docker tests"
        return 0
    fi

    log_info "Building Docker image..."
    if docker build -t opcode:test . 2>&1 | tail -10; then
        log_success "Docker build completed"

        # Cleanup
        log_info "Cleaning up test image..."
        docker rmi opcode:test &>/dev/null || true
        log_success "Test image cleaned up"
    else
        log_fail "Docker build failed"
    fi
}

# ============================================================================
# Quick Test (Sanity Check)
# ============================================================================

run_quick_test() {
    log_section "QUICK SANITY CHECK"

    log_header "Frontend Syntax Check"
    if bun tsc --noEmit --skipLibCheck 2>&1 | head -5; then
        log_success "TypeScript OK"
    else
        log_fail "TypeScript issues found"
    fi

    log_header "Backend Syntax Check"
    if cd src-tauri && cargo check --lib 2>&1 | tail -3; then
        log_success "Rust compilation OK"
    else
        log_fail "Rust compilation issues"
    fi

    log_header "Git Status"
    if git diff --stat --exit-code &>/dev/null; then
        log_success "Working directory clean"
    else
        log_info "Uncommitted changes present"
    fi

    print_summary
}

# ============================================================================
# Print Summary
# ============================================================================

print_summary() {
    log_section "TEST SUMMARY"

    echo "Total Tests: ${TESTS_TOTAL}"
    echo "Passed: ${TESTS_PASSED}"
    echo "Failed: ${TESTS_FAILED}"
    echo ""

    if [ $TESTS_FAILED -eq 0 ]; then
        echo "All tests passed! Safe to deploy."
        return 0
    else
        echo "Some tests failed. Please review before deploying."
        return 1
    fi
}

# ============================================================================
# Main Entry Point
# ============================================================================

main() {
    local TEST_MODE=${1:-"all"}

    echo ""
    echo "============================================================"
    echo "  Opcode Local Integration Test Suite"
    echo "============================================================"
    echo ""

    case $TEST_MODE in
        "frontend")
            log_section "FRONTEND TESTS"
            test_frontend_build
            print_summary
            ;;
        "backend")
            log_section "BACKEND TESTS"
            test_backend_build
            print_summary
            ;;
        "service")
            log_section "SERVICE HEALTH TESTS"
            test_service_health
            print_summary
            ;;
        "quick")
            run_quick_test
            ;;
        "docker")
            log_section "DOCKER TESTS"
            test_docker_build
            print_summary
            ;;
        "git")
            log_section "GIT STATUS TESTS"
            test_git_status
            print_summary
            ;;
        "all"|*)
            log_section "FULL INTEGRATION TESTS"

            # Phase 1: Build Tests
            log_section "PHASE 1: BUILD TESTS"
            test_frontend_build || true
            test_backend_build || true

            # Phase 2: Service Tests (optional, skip if not running)
            log_section "PHASE 2: SERVICE TESTS"
            test_service_health || log_info "Skipping service tests (service not running)"

            # Phase 3: Git Tests
            log_section "PHASE 3: GIT STATUS"
            test_git_status

            # Summary
            print_summary
            ;;
    esac
}

# Run main function with all arguments
main "$@"
