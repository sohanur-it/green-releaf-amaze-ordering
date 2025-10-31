#!/usr/bin/env node

/**
 * Comprehensive Production Sync Test Script
 * 
 * Tests all METRC sync operations in production database:
 * 1. Active Packages (Full Mirror)
 * 2. In-Transit Packages (Full Mirror)
 * 3. Outgoing Transfers (Incremental)
 * 4. Strains (Incremental)
 * 5. Items (Incremental)
 * 6. Batches (Module 3)
 * 7. Transferred Packages (Incremental) - LIMITED TO 10 PAGES
 * 
 * Usage: NODE_ENV=production node scripts/test-all-sync-prod.js
 */

const path = require('path');
const { spawn } = require('child_process');

// Load production environment
require('dotenv').config({ path: path.join(__dirname, '../config/production.env') });

// Color output helpers
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
    console.log('\n' + '='.repeat(60));
    log(`  ${title}`, 'bright');
    console.log('='.repeat(60) + '\n');
}

/**
 * Run a sync script and return result
 */
function runSyncScript(scriptName, description) {
    return new Promise((resolve, reject) => {
        log(`🔄 Starting: ${description}`, 'cyan');
        
        const startTime = Date.now();
        const scriptPath = path.join(__dirname, 'sync', scriptName);
        const proc = spawn('node', [scriptPath], {
            env: { ...process.env, NODE_ENV: 'production' },
            stdio: 'pipe'
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const output = data.toString();
            stdout += output;
            process.stdout.write(output);
        });

        proc.stderr.on('data', (data) => {
            const output = data.toString();
            stderr += output;
            process.stderr.write(output);
        });

        proc.on('close', (code) => {
            const duration = Date.now() - startTime;
            
            if (code === 0) {
                log(`✅ ${description} completed successfully (${(duration / 1000).toFixed(2)}s)`, 'green');
                resolve({ success: true, duration, stdout, stderr });
            } else {
                log(`❌ ${description} failed with exit code ${code}`, 'red');
                reject({ success: false, code, duration, stdout, stderr });
            }
        });

        proc.on('error', (error) => {
            log(`❌ ${description} error: ${error.message}`, 'red');
            reject({ success: false, error: error.message });
        });
    });
}

/**
 * Test transferred packages with 10-page limit
 */
async function testTransferredPackagesLimited() {
    logSection('Transferred Packages Sync (Limited to 10 Pages)');
    
    const Pool = require('pg').Pool;
    const metrcAuth = require('../Server/Services/metrcAuth');
    
    const DB_CONFIG = {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_DATABASE,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false }
    };

    const pool = new Pool(DB_CONFIG);
    let client;
    
    try {
        log('🔐 Authenticating with METRC...', 'cyan');
        const authSuccess = await metrcAuth.ensureValidToken();
        if (!authSuccess) {
            throw new Error('Failed to authenticate with METRC');
        }
        log('✅ Authentication successful', 'green');

        log('📡 Fetching transferred packages (max 10 pages)...', 'cyan');
        
        client = await pool.connect();
        await client.query('BEGIN');

        let allPackages = [];
        let page = 1;
        const maxPages = 10;
        const pageSize = 500;
        let hasMorePages = true;
        let totalPages = 0;

        while (hasMorePages && page <= maxPages) {
            log(`📄 Fetching page ${page}/${maxPages}...`, 'cyan');
            
            try {
                const response = await metrcAuth.makeAuthenticatedRequest({
                    method: 'GET',
                    url: `${metrcAuth.apiBaseUrl}/packages/transferred`,
                    params: {
                        licenseNumber: metrcAuth.licenseNumber,
                        page: page,
                        pageSize: pageSize
                    },
                    timeout: 30000
                });

                if (response.data && response.data.data) {
                    const packages = response.data.data;
                    allPackages = allPackages.concat(packages);
                    totalPages = response.data.totalPages || Math.ceil(response.data.total / pageSize);
                    
                    log(`✅ Retrieved ${packages.length} packages from page ${page} (total: ${allPackages.length})`, 'green');
                    
                    hasMorePages = page < totalPages;
                    page++;
                    
                    if (hasMorePages && page <= maxPages) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                } else {
                    log('⚠️ No data received for page ' + page, 'yellow');
                    hasMorePages = false;
                }
            } catch (error) {
                log(`❌ Error fetching page ${page}: ${error.message}`, 'red');
                throw error;
            }
        }

        log(`\n📊 Fetched ${allPackages.length} packages from ${Math.min(page - 1, maxPages)} pages`, 'cyan');
        log(`📈 Total pages available: ${totalPages} (limited to ${maxPages} for testing)`, 'cyan');

        // Process packages (simplified - just check we can process them)
        if (allPackages.length > 0) {
            log('✅ Successfully fetched transferred packages', 'green');
            log(`   Total packages in API: ${allPackages.length} (from ${Math.min(page - 1, maxPages)} pages)`, 'cyan');
        } else {
            log('⚠️ No packages found', 'yellow');
        }

        await client.query('COMMIT');
        
        return {
            success: true,
            packagesFetched: allPackages.length,
            pagesFetched: Math.min(page - 1, maxPages),
            totalPages: totalPages
        };
        
    } catch (error) {
        if (client) {
            await client.query('ROLLBACK');
        }
        log(`❌ Transferred packages sync failed: ${error.message}`, 'red');
        throw error;
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

/**
 * Main test execution
 */
async function runAllSyncTests() {
    logSection('PRODUCTION SYNC TEST SUITE');
    
    log(`📅 Test Started: ${new Date().toISOString()}`, 'cyan');
    log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`, 'cyan');
    log(`🏢 Database: ${process.env.DB_DATABASE}`, 'cyan');
    log(`🔗 Host: ${process.env.DB_HOST}`, 'cyan');
    
    const testResults = [];
    const startTime = Date.now();

    // Test 1: Active Packages
    try {
        const result = await runSyncScript('sync-active-packages.js', 'Active Packages Sync');
        testResults.push({ name: 'Active Packages', ...result });
    } catch (error) {
        testResults.push({ name: 'Active Packages', success: false, error: error.message });
    }

    // Test 2: In-Transit Packages
    try {
        const result = await runSyncScript('sync-intransit-packages.js', 'In-Transit Packages Sync');
        testResults.push({ name: 'In-Transit Packages', ...result });
    } catch (error) {
        testResults.push({ name: 'In-Transit Packages', success: false, error: error.message });
    }

    // Test 3: Outgoing Transfers
    try {
        const result = await runSyncScript('sync-outgoing-transfers.js', 'Outgoing Transfers Sync');
        testResults.push({ name: 'Outgoing Transfers', ...result });
    } catch (error) {
        testResults.push({ name: 'Outgoing Transfers', success: false, error: error.message });
    }

    // Test 4: Strains
    try {
        const result = await runSyncScript('sync-strains.js', 'Strains Sync');
        testResults.push({ name: 'Strains', ...result });
    } catch (error) {
        testResults.push({ name: 'Strains', success: false, error: error.message });
    }

    // Test 5: Items
    try {
        const result = await runSyncScript('sync-items.js', 'Items Sync');
        testResults.push({ name: 'Items', ...result });
    } catch (error) {
        testResults.push({ name: 'Items', success: false, error: error.message });
    }

    // Test 6: Batches (Module 3)
    try {
        const result = await runSyncScript('sync-batches.js', 'Batches Sync (Module 3)');
        testResults.push({ name: 'Batches', ...result });
    } catch (error) {
        testResults.push({ name: 'Batches', success: false, error: error.message });
    }

    // Test 7: Transferred Packages (LIMITED TO 10 PAGES - TEST LAST)
    try {
        const result = await testTransferredPackagesLimited();
        testResults.push({ name: 'Transferred Packages (10 pages)', ...result });
    } catch (error) {
        testResults.push({ name: 'Transferred Packages (10 pages)', success: false, error: error.message });
    }

    // Summary
    logSection('TEST SUMMARY');
    
    const totalDuration = Date.now() - startTime;
    const passed = testResults.filter(r => r.success).length;
    const failed = testResults.filter(r => !r.success).length;
    const total = testResults.length;

    log(`📊 Test Results:`, 'bright');
    console.log('');
    
    testResults.forEach(result => {
        const status = result.success ? '✅' : '❌';
        const duration = result.duration ? ` (${(result.duration / 1000).toFixed(2)}s)` : '';
        const color = result.success ? 'green' : 'red';
        
        if (result.success) {
            log(`   ${status} ${result.name}${duration}`, color);
            if (result.packagesFetched !== undefined) {
                log(`      📦 Packages: ${result.packagesFetched} (${result.pagesFetched} pages)`, 'cyan');
            }
        } else {
            log(`   ${status} ${result.name} - ${result.error || 'Failed'}`, color);
        }
    });

    console.log('');
    log(`✅ Passed: ${passed}/${total}`, passed === total ? 'green' : 'yellow');
    if (failed > 0) {
        log(`❌ Failed: ${failed}/${total}`, 'red');
    }
    log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(2)}s`, 'cyan');
    
    console.log('');
    
    if (passed === total) {
        log('🎉 ALL SYNC TESTS PASSED!', 'green');
        process.exit(0);
    } else {
        log('⚠️  SOME SYNC TESTS FAILED', 'red');
        process.exit(1);
    }
}

// Run tests
if (require.main === module) {
    runAllSyncTests().catch(error => {
        log(`\n❌ Fatal error: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    });
}

module.exports = { runAllSyncTests };

