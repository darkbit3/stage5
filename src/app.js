const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const ioClient = require('socket.io-client');
require('dotenv').config();

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

const app = express();
const server = http.createServer(app);

// CORS Configuration - Apply FIRST before any other middleware
app.use(cors());
app.options('*', cors());
app.use((req, res, next) => {
  // Set CORS headers for all responses
  res.header('Access-Control-Allow-Origin', 'https://bingo-0gwl.onrender.com');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Rate limiting to prevent overwhelming DB Manager
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for game data endpoints
const gameDataLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per minute for game data
  message: 'Too many game data requests, please wait before trying again.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting
app.use('/api/', gameDataLimiter);
app.use(generalLimiter);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Service configuration

// Hybrid DB Manager URL logic
const LOCAL_DB_MANAGER = 'http://localhost:3007';
const REMOTE_DB_MANAGER = 'https://db-manager-1.onrender.com';

function getDbManagerUrl() {
  // Try local first, fallback to remote
  return process.env.DB_MANAGER || LOCAL_DB_MANAGER;
}

let DB_MANAGER_URL = getDbManagerUrl();
// Test local, fallback to remote if not available
async function ensureDbManagerUrl() {
  try {
    await axios.get(LOCAL_DB_MANAGER + '/health', { timeout: 2000 });
    DB_MANAGER_URL = LOCAL_DB_MANAGER;
    return LOCAL_DB_MANAGER;
  } catch {
    DB_MANAGER_URL = REMOTE_DB_MANAGER;
    return REMOTE_DB_MANAGER;
  }
}

const services = {
  bigserver: { url: process.env.BIGSERVER_URL || `http://localhost:${process.env.BIGSERVER_PORT}`, name: 'Big Server', connected: false },
  db_manager: { url: DB_MANAGER_URL, name: 'DB Manager', connected: false }
};

const BIGSERVER_URL = services.bigserver.url;

// WebSocket client for real-time connection to DB Manager
let dbManagerSocket = null;
let realtimeConnected = false;

// Hybrid fallback for real-time game data
async function getGameDataHybrid(stage = 'k') {
  // Try WebSocket first
  if (dbManagerSocket && realtimeConnected) {
    return new Promise((resolve) => {
      let timeout = setTimeout(() => resolve(null), 2000);
      dbManagerSocket.emit('request-game-data', { stage, requestingStage: 'stage5', timestamp: new Date().toISOString() });
      dbManagerSocket.once('game-data-update', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
  }
  // Fallback to HTTP
  try {
    await ensureDbManagerUrl();
    const response = await axios.get(`${DB_MANAGER_URL}/api/v1/stage-${stage}/last-game-id`, { timeout: 5000 });
    return response.data;
  } catch {
    // Emergency fallback
    return null;
  }
}

// Simple in-memory cache for game data to reduce DB Manager load
const gameDataCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

const getCachedGameData = (stage) => {
  const cached = gameDataCache.get(stage);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`📋 Stage5: Using cached game data for Stage ${stage.toUpperCase()}`);
    return cached.data;
  }
  return null;
};

const setCachedGameData = (stage, data) => {
  gameDataCache.set(stage, {
    data,
    timestamp: Date.now()
  });
};

// Helper function for retrying DB Manager requests with exponential backoff
const retryDbRequest = async (requestFn, maxRetries = 3, baseDelay = 1000) => {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;

      if (error.response?.status === 429) {
        // Rate limited - wait longer
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
        console.log(`⏳ DB Manager rate limited (429), retrying in ${Math.round(delay/1000)}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (error.response?.status >= 500) {
        // Server error - retry with shorter delay
        const delay = baseDelay * Math.pow(1.5, attempt);
        console.log(`⏳ DB Manager server error (${error.response.status}), retrying in ${Math.round(delay/1000)}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // Non-retryable error
        throw error;
      }
    }
  }

  throw lastError;
};

// Enhanced service connection checking with retry logic
const checkServiceConnections = async () => {
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds

  const checkWithRetry = async (serviceName, url, headers = {}, retries = maxRetries) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(url, { timeout: 5000, headers });
        if (response.status === 200) {
          return { success: true, data: response.data };
        }
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        console.log(`⚠️  ${serviceName} connection attempt ${i + 1} failed, retrying in ${retryDelay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  };

  try {
    // Check BigServer connection with API key
    try {
      const bigserverResult = await checkWithRetry(
        'BigServer',
        services.bigserver.url,
        { 'x-api-key': process.env.BIGSERVER_API_KEY }
      );

      services.bigserver.connected = true;
      console.log('✅ Connected to Big Server (Port ' + process.env.BIGSERVER_PORT + ') with API key');
      console.log('   📊 Big Server Status:', bigserverResult.data.status);
      logger.info(`✅ Big Server (Port ${process.env.BIGSERVER_PORT}) is connected`);

    } catch (error) {
      services.bigserver.connected = false;
      console.log('❌ Failed to connect to Big Server (Port ' + process.env.BIGSERVER_PORT + '):', error.message);
      if (error.response && error.response.status === 401) {
        console.log('🔑 API Key authentication failed - check your API key configuration');
      }
      logger.warn(`❌ Big Server (Port ${process.env.BIGSERVER_PORT}) connection error: ${error.message}`);
    }

    // Check DB Manager connection
    try {
      const dbManagerResult = await checkWithRetry('DB Manager', services.db_manager.url);

      services.db_manager.connected = true;
      console.log('✅ Connected to DB Manager (Port ' + process.env.DB_MANAGER_PORT + ')');
      console.log('   📊 DB Manager Status:', dbManagerResult.data.status);
      console.log('   🗄️  Database Status:', dbManagerResult.data.databases?.sqlite?.status || 'Unknown');
      logger.info(`✅ DB Manager (Port ${process.env.DB_MANAGER_PORT}) is connected`);

    } catch (error) {
      services.db_manager.connected = false;
      console.log('❌ Failed to connect to DB Manager (Port ' + process.env.DB_MANAGER_PORT + '):', error.message);
      logger.warn(`❌ DB Manager (Port ${process.env.DB_MANAGER_PORT}) connection error: ${error.message}`);
    }

    // Enhanced connection summary
    const connectionStatus = {
      bigserver: services.bigserver.connected ? 'connected' : 'disconnected',
      db_manager: services.db_manager.connected ? 'connected' : 'disconnected',
      overall: (services.bigserver.connected && services.db_manager.connected) ? 'healthy' : 'degraded'
    };

    console.log('📊 Connection Status Summary:', connectionStatus);

  } catch (error) {
    console.error('Error checking service connections:', error.message);
    logger.error('Error checking service connections:', error.message);
  }
};

// Initialize WebSocket connection to DB Manager
const initializeSocketConnection = async () => {
  try {
    await ensureDbManagerUrl();
    // Close existing connection if any
    if (dbManagerSocket) {
      dbManagerSocket.disconnect();
    }

    console.log('🔌 Stage5: Initializing WebSocket connection to DB Manager...');

    // Create socket connection to DB Manager
    dbManagerSocket = ioClient(DB_MANAGER_URL, {
      transports: ['websocket', 'polling'],
      timeout: 5000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5
    });

    // Connection event handlers
    dbManagerSocket.on('connect', () => {
      console.log('✅ Stage5: Connected to DB Manager via WebSocket');
      realtimeConnected = true;

      // Identify ourselves as Stage 5
      dbManagerSocket.emit('stage5-connect', {
        stage: 'stage5',
        timestamp: new Date().toISOString()
      });

      logger.info('✅ Stage5: WebSocket connection established with DB Manager');
    });

    dbManagerSocket.on('disconnect', (reason) => {
      console.log('❌ Stage5: Disconnected from DB Manager:', reason);
      realtimeConnected = false;
      logger.warn(`❌ Stage5: WebSocket disconnected from DB Manager: ${reason}`);
    });

    dbManagerSocket.on('connect_error', (error) => {
      console.log('❌ Stage5: WebSocket connection error:', error.message);
      realtimeConnected = false;
      logger.error('❌ Stage5: WebSocket connection error:', error.message);
    });

    dbManagerSocket.on('db-manager-connected', (data) => {
      console.log('📡 Stage5: DB Manager acknowledged connection:', data);
    });

    dbManagerSocket.on('game-data-update', (data) => {
      console.log('📊 Stage5: Received game data update:', data);
    });

    dbManagerSocket.on('bet-update', (data) => {
      console.log('💰 Stage5: Received bet update notification:', data);
    });

    dbManagerSocket.on('db-status-update', (data) => {
      console.log('🗄️ Stage5: Received DB status update:', data);
    });

  } catch (error) {
    console.error('❌ Stage5: Error initializing WebSocket connection:', error.message);
    realtimeConnected = false;
    logger.error('❌ Stage5: WebSocket initialization error:', error.message);
  }
};

// Function to notify DB Manager of bet placements
const notifyBetPlaced = (betData) => {
  if (dbManagerSocket && realtimeConnected) {
    try {
      dbManagerSocket.emit('bet-placed', {
        stage: 'stage5',
        ...betData,
        timestamp: new Date().toISOString()
      });
      console.log('📤 Stage5: Bet placement notification sent to DB Manager');
    } catch (error) {
      console.error('❌ Stage5: Error sending bet notification:', error.message);
    }
  } else {
    console.log('⚠️ Stage5: Cannot send bet notification - WebSocket not connected');
  }
};

// Function to request real-time game data
const requestRealtimeGameData = (stage = 'k') => {
  if (dbManagerSocket && realtimeConnected) {
    try {
      dbManagerSocket.emit('request-game-data', {
        stage: stage,
        requestingStage: 'stage5',
        timestamp: new Date().toISOString()
      });
      console.log(`📤 Stage5: Requested real-time game data for Stage ${stage.toUpperCase()}`);
    } catch (error) {
      console.error('❌ Stage5: Error requesting game data:', error.message);
    }
  } else {
    console.log('⚠️ Stage5: Cannot request game data - WebSocket not connected');
  }
};

// Note: MongoDB connection removed as it is not used in this version.

// Middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 1000
});
app.use(limiter);

app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
const apiPrefix = '/api/v1';
app.use(`${apiPrefix}/games`, require('./routes/gameRoutes'));
app.use(`${apiPrefix}/patterns`, require('./routes/patternRoutes'));

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Stage 5 Backend API is running!',
    stage: 'Stage 5',
    port: process.env.PORT,
    connections: {
      bigserver: bigserverConnected,
      db_manager: dbManagerConnected,
      realtime: realtimeConnected
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    stage: 'Stage 5',
    port: process.env.PORT,
    connections: {
      bigserver: services.bigserver.connected,
      db_manager: services.db_manager.connected,
      realtime: realtimeConnected
    },
    timestamp: new Date().toISOString()
  });
});

// Service status endpoint
app.get('/services', (req, res) => {
  res.json({
    stage: 'Stage 5',
    services: {
      bigserver: {
        url: services.bigserver.url,
        connected: services.bigserver.connected,
        port: getPortFromUrl(services.bigserver.url)
      },
      db_manager: {
        url: services.db_manager.url,
        connected: services.db_manager.connected,
        port: getPortFromUrl(services.db_manager.url)
      }
    }
  });
});

// Get latest game data with highest game ID and parsed selectedBoard
app.get('/api/v1/game/latest-data', async (req, res) => {
  try {
    const { stage = 'k' } = req.query; // Default to stage K for Stage5
    console.log(`🔍 Stage5: Requesting latest game data for Stage ${stage.toUpperCase()}...`);

    // Check cache first
    const cachedData = getCachedGameData(stage);
    if (cachedData) {
      console.log(`✅ Stage5: Returning cached game data for Stage ${stage.toUpperCase()}`);
      return res.json({
        success: true,
        data: cachedData,
        source: 'cache',
        stage: 'stage5',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔍 Stage5: Cache miss, requesting from DB Manager for Stage ${stage.toUpperCase()}...`);

    // Request highest game ID record from DB Manager for specific stage with retry

    // Hybrid: ensure DB Manager URL is correct before each call
    await ensureDbManagerUrl();
    const response = await retryDbRequest(async () => {
      return axios.get(`${DB_MANAGER_URL}/api/v1/stage-${stage}/last-game-id`, {
        timeout: 10000
      });
    });

    if (response.data && response.data.success && response.data.data) {
      const gameData = response.data.data;
      console.log(`✅ Stage5: Found existing game data for Stage ${stage.toUpperCase()}:`, gameData);

      // Parse selectedBoard format: "+251909090909:2,+251909090910:4"
      const parsedData = parseSelectedBoard(gameData.selectedBoard || '');

      // Format response for frontend
      const formattedResponse = {
        gameId: gameData.gameId || '',
        payout: gameData.payout || 0,
        players: parsedData.playerIds,
        boards: parsedData.boards,
        totalPlayers: parsedData.totalPlayers,
        stage: stage.toUpperCase(),
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Stage5: Returning existing game data for frontend:`, formattedResponse);

      // Cache the formatted response
      setCachedGameData(stage, formattedResponse);

      res.json({
        success: true,
        data: formattedResponse,
        source: 'db_manager',
        stage: 'stage5',
        timestamp: new Date().toISOString()
      });
    } else {
      // No existing data found, create a new game
      console.log(`📝 Stage5: No existing data found for Stage ${stage.toUpperCase()}, creating new game...`);

      const newGameData = await createNewGameForStage(stage.toLowerCase());
      console.log(`✅ Stage5: Created new game for Stage ${stage.toUpperCase()}:`, newGameData);

      res.json({
        success: true,
        data: newGameData,
        source: 'newly_created',
        stage: 'stage5',
        message: `New game created for Stage ${stage.toUpperCase()}`,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Stage5: Error getting latest game data from DB Manager:', error.message);

    // Try to create a new game even if DB Manager fails
    try {
      const { stage = 'k' } = req.query;
      console.log(`🔄 Stage5: DB Manager failed, attempting to create new game for Stage ${stage.toUpperCase()}...`);

      const newGameData = await createNewGameForStage(stage.toLowerCase());
      console.log(`✅ Stage5: Created fallback game for Stage ${stage.toUpperCase()}:`, newGameData);

      res.json({
        success: true,
        data: newGameData,
        source: 'fallback_created',
        stage: 'stage5',
        warning: 'DB Manager unavailable, created new game',
        timestamp: new Date().toISOString()
      });
    } catch (createError) {
      console.error('❌ Stage5: Failed to create fallback game:', createError.message);

      // Last resort fallback - extract stage from req.query again
      const { stage = 'k' } = req.query;
      const fallbackData = {
        gameId: 'G' + Date.now().toString().slice(-5),
        payout: 0,
        players: '',
        boards: '',
        totalPlayers: 0,
        stage: stage.toUpperCase(),
        timestamp: new Date().toISOString()
      };

      res.json({
        success: true,
        data: fallbackData,
        source: 'emergency_fallback',
        stage: 'stage5',
        warning: 'All systems failed, using emergency fallback',
        timestamp: new Date().toISOString()
      });
    }
  }
});

// Helper function to parse selectedBoard format
function parseSelectedBoard(selectedBoard) {
  try {
    if (!selectedBoard || typeof selectedBoard !== 'string') {
      return {
        playerIds: '',
        boards: '',
        totalPlayers: 0
      };
    }

    console.log('🔍 Stage5: Parsing selectedBoard:', selectedBoard);

    // Split by comma to get individual player:board pairs
    const pairs = selectedBoard.split(',');

    const playerIds = [];
    const boards = [];

    pairs.forEach(pair => {
      if (pair && pair.includes(':')) {
        const parts = pair.split(':');
        if (parts.length >= 2) {
          // Player ID is the first part, board number is the last part
          const playerId = parts[0].trim();
          const boardNum = parts[parts.length - 1].trim();

          if (playerId && boardNum) {
            playerIds.push(playerId);
            boards.push(boardNum);
            console.log(`✅ Stage5: Parsed: ${playerId} → Board ${boardNum}`);
          }
        }
      }
    });

    const result = {
      playerIds: playerIds.join(','),
      boards: boards.join(','),
      totalPlayers: playerIds.length
    };

    console.log('✅ Stage5: Parse result:', result);
    return result;
  } catch (error) {
    console.error('❌ Stage5: Error parsing selectedBoard:', error.message);
    return {
      playerIds: '',
      boards: '',
      totalPlayers: 0
    };
  }
}

// Helper function to create a new game when no existing DB data is available
async function createNewGameForStage(stage) {
  try {
    const timestamp = Date.now();
    const gameId = `G${timestamp.toString().slice(-5)}`;

    console.log(`🎮 Stage5: No existing game data found for Stage ${stage.toUpperCase()}`);

    // Return empty game state - no sample data
    return {
      gameId: gameId,
      payout: 0,
      players: '',
      boards: '',
      totalPlayers: 0,
      stage: stage.toUpperCase(),
      timestamp: new Date().toISOString(),
      message: 'No active game found. Please place bets to start a new game.'
    };
  } catch (error) {
    console.error('❌ Stage5: Error creating empty game response:', error.message);
    throw error;
  }
}

// Helper function to create a new game when no data exists
async function createNewGameForStage(stage) {
  try {
    const timestamp = Date.now();
    const gameId = (timestamp % 100000).toString().padStart(5, '0');

    console.log(`🎮 Stage5: No existing game data found for Stage ${stage.toUpperCase()}`);

    return {
      gameId: gameId,
      payout: 0,
      players: '',
      boards: '',
      totalPlayers: 0,
      stage: stage.toUpperCase(),
      timestamp: new Date().toISOString(),
      message: 'No active game found. Please place bets to start a new game.'
    };
  } catch (error) {
    console.error(`❌ Stage5: Error creating empty game response for stage ${stage}:`, error.message);
    throw error;
  }
}


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT;

// Start server and check connections
server.listen(PORT, async () => {
  console.log(`🚀 Stage 5 Backend API is running on port ${PORT}`);
  console.log(`📋 Health Check: http://localhost:${PORT}/health`);
  console.log(`🔗 Services Status: http://localhost:${PORT}/services`);
  console.log('---');

  // Check service connections on startup
  await checkServiceConnections();

  // Initialize WebSocket connection to DB Manager
  await initializeSocketConnection();

  // Check connections every 30 seconds
  setInterval(checkServiceConnections, 30000);
});

module.exports = { app, server, io };
