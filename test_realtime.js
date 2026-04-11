const io = require('socket.io-client');

// Configuration
const DB_MANAGER_URL = process.env.DB_MANAGER || 'http://localhost:3000';
const STAGE5_PORT = process.env.PORT || 3005;

console.log('🧪 Stage 5 Real-time Connection Test');
console.log('=====================================');
console.log(`DB Manager URL: ${DB_MANAGER_URL}`);
console.log(`Stage 5 Port: ${STAGE5_PORT}`);
console.log('---');

// Test WebSocket connection
const testSocketConnection = () => {
  return new Promise((resolve, reject) => {
    console.log('🔌 Testing WebSocket connection to DB Manager...');

    const socket = io(DB_MANAGER_URL, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
      reconnection: false // Disable reconnection for testing
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Connection timeout after 5 seconds'));
    }, 5000);

    socket.on('connect', () => {
      console.log('✅ Successfully connected to DB Manager');
      clearTimeout(timeout);

      // Identify as Stage 5
      socket.emit('stage5-connect', {
        stage: 'stage5',
        test: true,
        timestamp: new Date().toISOString()
      });

      // Wait for acknowledgment
      socket.on('db-manager-connected', (data) => {
        console.log('📡 DB Manager acknowledged Stage 5 connection:', data);

        // Test bet notification
        console.log('💰 Testing bet placement notification...');
        socket.emit('bet-placed', {
          stage: 'stage5',
          playerId: '+251900000000',
          amount: 100,
          board: 1,
          test: true,
          timestamp: new Date().toISOString()
        });

        // Test game data request
        setTimeout(() => {
          console.log('📊 Testing game data request...');
          socket.emit('request-game-data', {
            stage: 'k',
            requestingStage: 'stage5',
            test: true,
            timestamp: new Date().toISOString()
          });

          // Disconnect after tests
          setTimeout(() => {
            socket.disconnect();
            resolve();
          }, 2000);
        }, 1000);
      });
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Connection failed: ${error.message}`));
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Disconnected from DB Manager: ${reason}`);
    });

    socket.on('bet-update', (data) => {
      console.log('📨 Received bet update:', data);
    });

    socket.on('game-data-update', (data) => {
      console.log('📊 Received game data update:', data);
    });
  });
};

// Test HTTP health check
const testHealthCheck = async () => {
  try {
    console.log('🏥 Testing Stage 5 health check...');
    const response = await fetch(`http://localhost:${STAGE5_PORT}/health`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Health check successful:', data);

    if (data.connections.realtime) {
      console.log('✅ Real-time connection is active');
    } else {
      console.log('⚠️ Real-time connection is not active');
    }

  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    throw error;
  }
};

// Run all tests
const runTests = async () => {
  try {
    console.log('🚀 Starting Stage 5 real-time connection tests...\n');

    // Test HTTP health check first
    await testHealthCheck();
    console.log('');

    // Test WebSocket connection
    await testSocketConnection();
    console.log('');

    console.log('🎉 All tests completed successfully!');
    console.log('✅ Stage 5 real-time connection to DB Manager is working');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
};

// Run tests if this script is executed directly
if (require.main === module) {
  runTests();
}

module.exports = { testSocketConnection, testHealthCheck, runTests };