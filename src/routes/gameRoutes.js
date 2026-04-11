const express = require('express');
const router = express.Router();

// Mock game data for Stage 5 (Winning Detection)
let games = [
  {
    id: 1,
    name: 'Bingo Game 1',
    stage: 'Stage 5',
    status: 'detecting',
    settings: {
      winPatterns: ['line', 'full_house', 'four_corners', 'diagonal'],
      autoDetectWins: true,
      requireVerification: false
    },
    calledNumbers: [1, 15, 30, 45, 60, 7, 22, 37, 52, 67],
    winners: [],
    pendingWins: [],
    players: [
      {
        id: 'player1',
        name: 'John Doe',
        cards: [
          {
            id: 'card1',
            numbers: [1, 15, 30, 45, 60, 2, 16, 31, 46, 61, 3, 17, 32, 47, 62, 4, 18, 33, 48, 63, 5, 19, 34, 49, 64],
            markedNumbers: [1, 15, 30, 45, 60],
            status: 'active'
          }
        ]
      }
    ]
  }
];

// GET /api/games - Get all games
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: games,
    count: games.length,
    stage: 'Stage 5 - Winning Detection'
  });
});

// GET /api/games/:id - Get specific game
router.get('/:id', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  res.json({
    success: true,
    data: game
  });
});

// POST /api/games/:id/check-win - Check for wins
router.post('/:id/check-win', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const { playerId, cardId, pattern } = req.body;
  
  if (!playerId || !cardId || !pattern) {
    return res.status(400).json({
      success: false,
      error: 'Player ID, card ID, and pattern are required'
    });
  }
  
  const player = game.players.find(p => p.id === playerId);
  if (!player) {
    return res.status(404).json({
      success: false,
      error: 'Player not found in game'
    });
  }
  
  const card = player.cards.find(c => c.id === cardId);
  if (!card) {
    return res.status(404).json({
      success: false,
      error: 'Card not found'
    });
  }
  
  // Check if pattern is valid
  if (!game.settings.winPatterns.includes(pattern)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid pattern for this game'
    });
  }
  
  // Check for win
  const winResult = checkWinPattern(card, game.calledNumbers, pattern);
  
  if (winResult.isWin) {
    const winEntry = {
      id: `win_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      gameId: game.id,
      playerId: playerId,
      playerName: player.name,
      cardId: cardId,
      pattern: pattern,
      calledNumbers: [...game.calledNumbers],
      detectedAt: new Date().toISOString(),
      verified: !game.settings.requireVerification,
      winningNumbers: winResult.winningNumbers
    };
    
    if (game.settings.requireVerification) {
      game.pendingWins.push(winEntry);
    } else {
      game.winners.push(winEntry);
    }
    
    res.json({
      success: true,
      data: winEntry,
      message: 'Win detected successfully'
    });
  } else {
    res.json({
      success: true,
      data: { isWin: false, pattern },
      message: 'No win detected'
    });
  }
});

// GET /api/games/:id/winners - Get game winners
router.get('/:id/winners', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  res.json({
    success: true,
    data: {
      winners: game.winners,
      pendingWins: game.pendingWins,
      totalWinners: game.winners.length,
      pendingCount: game.pendingWins.length
    }
  });
});

// POST /api/games/:id/verify-win - Verify a pending win
router.post('/:id/verify-win', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const { winId, verified } = req.body;
  
  if (!winId || typeof verified !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Win ID and verification status are required'
    });
  }
  
  const pendingIndex = game.pendingWins.findIndex(w => w.id === winId);
  if (pendingIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Pending win not found'
    });
  }
  
  const pendingWin = game.pendingWins.splice(pendingIndex, 1)[0];
  pendingWin.verified = verified;
  pendingWin.verifiedAt = new Date().toISOString();
  
  if (verified) {
    game.winners.push(pendingWin);
  }
  
  res.json({
    success: true,
    data: pendingWin,
    message: `Win ${verified ? 'verified' : 'rejected'} successfully`
  });
});

// GET /api/games/:id/player/:playerId/card/:cardId/status - Get card win status
router.get('/:id/player/:playerId/card/:cardId/status', (req, res) => {
  const game = games.find(g => g.id === parseInt(req.params.id));
  if (!game) {
    return res.status(404).json({
      success: false,
      error: 'Game not found'
    });
  }
  
  const player = game.players.find(p => p.id === req.params.playerId);
  if (!player) {
    return res.status(404).json({
      success: false,
      error: 'Player not found in game'
    });
  }
  
  const card = player.cards.find(c => c.id === req.params.cardId);
  if (!card) {
    return res.status(404).json({
      success: false,
      error: 'Card not found'
    });
  }
  
  const statusResults = game.settings.winPatterns.map(pattern => {
    const result = checkWinPattern(card, game.calledNumbers, pattern);
    return {
      pattern,
      isWin: result.isWin,
      winningNumbers: result.winningNumbers,
      numbersNeeded: result.numbersNeeded
    };
  });
  
  res.json({
    success: true,
    data: {
      cardId: card.id,
      markedNumbers: card.markedNumbers,
      calledNumbers: game.calledNumbers,
      patterns: statusResults,
      hasWon: statusResults.some(s => s.isWin)
    }
  });
});

// Helper function to check win patterns
function checkWinPattern(card, calledNumbers, pattern) {
  const cardNumbers = card.numbers;
  const marked = new Set(calledNumbers);
  
  const isMarked = (index) => {
    // Check if it's the free space (center position)
    if (index === 12) return true; // Center of 5x5 card (0-indexed)
    return marked.has(cardNumbers[index]);
  };
  
  let winningNumbers = [];
  let isWin = false;
  
  switch (pattern) {
    case 'line':
      // Check all possible lines (rows, columns)
      const lines = [
        // Rows
        [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14],
        [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
        // Columns
        [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22],
        [3, 8, 13, 18, 23], [4, 9, 14, 19, 24]
      ];
      
      for (const line of lines) {
        if (line.every(isMarked)) {
          isWin = true;
          winningNumbers = line.map(i => cardNumbers[i]);
          break;
        }
      }
      break;
      
    case 'full_house':
      // All numbers marked
      for (let i = 0; i < cardNumbers.length; i++) {
        if (!isMarked(i)) {
          break;
        }
        if (i === cardNumbers.length - 1) {
          isWin = true;
          winningNumbers = cardNumbers;
        }
      }
      break;
      
    case 'four_corners':
      const corners = [0, 4, 20, 24];
      if (corners.every(isMarked)) {
        isWin = true;
        winningNumbers = corners.map(i => cardNumbers[i]);
      }
      break;
      
    case 'diagonal':
      const diagonals = [
        [0, 6, 12, 18, 24], // Top-left to bottom-right
        [4, 8, 12, 16, 20]  // Top-right to bottom-left
      ];
      
      for (const diagonal of diagonals) {
        if (diagonal.every(isMarked)) {
          isWin = true;
          winningNumbers = diagonal.map(i => cardNumbers[i]);
          break;
        }
      }
      break;
  }
  
  // Calculate numbers needed for completion
  const numbersNeeded = [];
  if (!isWin) {
    // This is simplified - in real implementation, would calculate based on pattern
    for (let i = 0; i < cardNumbers.length; i++) {
      if (!isMarked(i)) {
        numbersNeeded.push(cardNumbers[i]);
      }
    }
  }
  
  return {
    isWin,
    winningNumbers,
    numbersNeeded: numbersNeeded.slice(0, 5) // Show first 5 needed numbers
  };
}

module.exports = router;
