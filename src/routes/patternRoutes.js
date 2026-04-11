const express = require('express');
const router = express.Router();

// Win pattern definitions
const winPatterns = {
  line: {
    name: 'Line',
    description: 'Complete any horizontal, vertical, or diagonal line',
    difficulty: 'easy',
    positions: {
      rows: [
        [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14],
        [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]
      ],
      columns: [
        [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22],
        [3, 8, 13, 18, 23], [4, 9, 14, 19, 24]
      ],
      diagonals: [
        [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
      ]
    }
  },
  full_house: {
    name: 'Full House',
    description: 'Mark all numbers on the card',
    difficulty: 'hard',
    positions: 'all'
  },
  four_corners: {
    name: 'Four Corners',
    description: 'Mark all four corner numbers',
    difficulty: 'easy',
    positions: [0, 4, 20, 24]
  },
  diagonal: {
    name: 'Diagonal',
    description: 'Complete either diagonal line',
    difficulty: 'medium',
    positions: [
      [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
    ]
  },
  postage_stamp: {
    name: 'Postage Stamp',
    description: 'Mark any 2x2 square',
    difficulty: 'medium',
    positions: [
      [0, 1, 5, 6], [1, 2, 6, 7], [2, 3, 7, 8], [3, 4, 8, 9],
      [5, 6, 10, 11], [6, 7, 11, 12], [7, 8, 12, 13], [8, 9, 13, 14],
      [10, 11, 15, 16], [11, 12, 16, 17], [12, 13, 17, 18], [13, 14, 18, 19],
      [15, 16, 20, 21], [16, 17, 21, 22], [17, 18, 22, 23], [18, 19, 23, 24]
    ]
  },
  letter_x: {
    name: 'Letter X',
    description: 'Mark both diagonals to form an X',
    difficulty: 'medium',
    positions: [
      [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
    ]
  },
  letter_t: {
    name: 'Letter T',
    description: 'Mark the top row and middle column',
    difficulty: 'medium',
    positions: {
      top_row: [0, 1, 2, 3, 4],
      middle_column: [2, 7, 12, 17, 22]
    }
  }
};

// GET /api/patterns - Get all win patterns
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: winPatterns,
    count: Object.keys(winPatterns).length,
    stage: 'Stage 5 - Winning Detection'
  });
});

// GET /api/patterns/:patternId - Get specific pattern
router.get('/:patternId', (req, res) => {
  const pattern = winPatterns[req.params.patternId];
  if (!pattern) {
    return res.status(404).json({
      success: false,
      error: 'Pattern not found'
    });
  }
  res.json({
    success: true,
    data: pattern
  });
});

// POST /api/patterns/check - Check if a card matches any pattern
router.post('/check', (req, res) => {
  const { cardNumbers, calledNumbers, patternsToCheck = Object.keys(winPatterns) } = req.body;
  
  if (!cardNumbers || !Array.isArray(cardNumbers) || !calledNumbers || !Array.isArray(calledNumbers)) {
    return res.status(400).json({
      success: false,
      error: 'Card numbers and called numbers arrays are required'
    });
  }
  
  const marked = new Set(calledNumbers);
  const results = [];
  
  const isMarked = (index) => {
    if (index === 12) return true; // Free space
    return marked.has(cardNumbers[index]);
  };
  
  for (const patternId of patternsToCheck) {
    const pattern = winPatterns[patternId];
    if (!pattern) continue;
    
    let isWin = false;
    let winningPositions = [];
    
    switch (patternId) {
      case 'line':
        // Check all lines
        const allLines = [
          ...pattern.positions.rows,
          ...pattern.positions.columns,
          ...pattern.positions.diagonals
        ];
        
        for (const line of allLines) {
          if (line.every(isMarked)) {
            isWin = true;
            winningPositions = line;
            break;
          }
        }
        break;
        
      case 'full_house':
        isWin = cardNumbers.every((_, index) => isMarked(index));
        if (isWin) winningPositions = Array.from({length: 25}, (_, i) => i);
        break;
        
      case 'four_corners':
        isWin = pattern.positions.every(isMarked);
        if (isWin) winningPositions = pattern.positions;
        break;
        
      case 'diagonal':
        for (const diagonal of pattern.positions) {
          if (diagonal.every(isMarked)) {
            isWin = true;
            winningPositions = diagonal;
            break;
          }
        }
        break;
        
      case 'postage_stamp':
        for (const square of pattern.positions) {
          if (square.every(isMarked)) {
            isWin = true;
            winningPositions = square;
            break;
          }
        }
        break;
        
      case 'letter_x':
        const diag1 = pattern.positions[0];
        const diag2 = pattern.positions[1];
        if (diag1.every(isMarked) && diag2.every(isMarked)) {
          isWin = true;
          winningPositions = [...diag1, ...diag2];
        }
        break;
        
      case 'letter_t':
        const topRow = pattern.positions.top_row;
        const middleCol = pattern.positions.middle_column;
        if (topRow.every(isMarked) && middleCol.every(isMarked)) {
          isWin = true;
          winningPositions = [...topRow, ...middleCol];
        }
        break;
    }
    
    results.push({
      patternId,
      patternName: pattern.name,
      isWin,
      winningPositions,
      winningNumbers: winningPositions.map(pos => cardNumbers[pos]),
      difficulty: pattern.difficulty
    });
  }
  
  res.json({
    success: true,
    data: {
      checkedPatterns: results,
      hasWon: results.some(r => r.isWin),
      winningPatterns: results.filter(r => r.isWin)
    }
  });
});

// POST /api/patterns/custom - Create a custom pattern
router.post('/custom', (req, res) => {
  const { name, description, positions, difficulty = 'custom' } = req.body;
  
  if (!name || !description || !positions) {
    return res.status(400).json({
      success: false,
      error: 'Name, description, and positions are required'
    });
  }
  
  // Validate positions
  if (!Array.isArray(positions) || positions.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Positions must be a non-empty array'
    });
  }
  
  // Check if positions are valid (0-24)
  for (const pos of positions) {
    if (typeof pos !== 'number' || pos < 0 || pos > 24) {
      return res.status(400).json({
        success: false,
        error: 'Positions must be numbers between 0 and 24'
      });
    }
  }
  
  const customPattern = {
    name,
    description,
    difficulty,
    positions,
    isCustom: true,
    createdAt: new Date().toISOString()
  };
  
  // In a real implementation, would save to database
  const customId = `custom_${Date.now()}`;
  winPatterns[customId] = customPattern;
  
  res.status(201).json({
    success: true,
    data: {
      id: customId,
      ...customPattern
    },
    message: 'Custom pattern created successfully'
  });
});

// GET /api/patterns/statistics - Get pattern statistics
router.get('/statistics', (req, res) => {
  // Mock statistics (in real implementation, would come from database)
  const statistics = {
    totalWins: 1250,
    patternWins: {
      line: { wins: 450, percentage: 36.0, avgCalls: 18.5 },
      full_house: { wins: 200, percentage: 16.0, avgCalls: 45.2 },
      four_corners: { wins: 300, percentage: 24.0, avgCalls: 12.3 },
      diagonal: { wins: 180, percentage: 14.4, avgCalls: 22.1 },
      postage_stamp: { wins: 80, percentage: 6.4, avgCalls: 28.7 },
      letter_x: { wins: 40, percentage: 3.2, avgCalls: 35.6 }
    },
    difficultyDistribution: {
      easy: { wins: 750, percentage: 60.0 },
      medium: { wins: 400, percentage: 32.0 },
      hard: { wins: 100, percentage: 8.0 }
    },
    averageGameDuration: 1800,
    averageCallsPerWin: 24.3
  };
  
  res.json({
    success: true,
    data: statistics
  });
});

module.exports = router;
