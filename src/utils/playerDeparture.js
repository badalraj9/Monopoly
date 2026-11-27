export function advanceTurnForInactivity(game) {
  const turn = nextActiveSeat(game.players, game.turn);
  return clearTurnState({ ...game, turn, message: '' });
}

function nextActiveSeat(players, from) {
  for (let offset = 1; offset <= players.length; offset++) {
    const seat = (from + offset) % players.length;
    if (players[seat]?.active) return seat;
  }
  return from;
}

function clearTurnState(game) {
  game.phase = 'WAIT_FOR_ROLL';
  game.rolls = 0;
  game.rentMultiplier = 1;
  delete game.pending;
  delete game.auction;
  delete game.moveFrom;
  delete game.moveTo;
  delete game.moveSteps;
  return game;
}

export function removePlayerFromGame(game, index) {
  const departing = game.players[index];
  if (!departing?.active) return game;

  const currentPlayerLeft = index === game.turn;
  const creditor = currentPlayerLeft ? game.pending?.to : undefined;
  const players = game.players.map((player, seat) => {
    if (seat === index) {
      return { ...player, active: false, cash: 0, owned: [], buildings: {}, mortgaged: [], jailCard: 0 };
    }
    if (seat === creditor) {
      return {
        ...player,
        cash: player.cash + Math.max(0, departing.cash),
        owned: [...player.owned, ...departing.owned],
        buildings: { ...player.buildings, ...departing.buildings },
        mortgaged: [...new Set([...player.mortgaged, ...departing.mortgaged])],
        jailCard: player.jailCard + departing.jailCard
      };
    }
    return player;
  });
  const remaining = players.filter(player => player.active);
  const winner = remaining.length === 1 ? remaining[0].name : undefined;
  const next = { ...game, players, winner };

  if (currentPlayerLeft || remaining.length <= 1) {
    next.turn = nextActiveSeat(players, game.turn);
    clearTurnState(next);
    if (remaining.length <= 1) next.phase = 'GAME_OVER';
  } else if (game.phase === 'AUCTION' && game.auction) {
    const auction = { ...game.auction };
    if (auction.highestPlayer === index) {
      auction.highestPlayer = -1;
      auction.highestBid = 0;
      auction.passed = [];
    }
    if (auction.turn === index) {
      const eligible = players.flatMap((player, seat) => player.active && !auction.passed.includes(seat) && seat !== auction.highestPlayer ? [seat] : []);
      if (eligible.length) {
        auction.turn = eligible.find(seat => seat > index) ?? eligible[0];
        auction.seconds = 10;
      } else {
        auction.turn = next.turn;
        auction.seconds = 1;
      }
    }
    next.auction = auction;
  }

  next.trades = (game.trades || []).filter(trade => trade.from !== index && trade.to !== index);
  next.message = winner ? `${winner} wins the game.` : `${departing.name} left the game.`;
  next.log = [
    creditor === undefined
      ? `${departing.name} left the game; remaining assets returned to the Bank.`
      : `${departing.name} left the game; remaining assets transferred to ${players[creditor].name}.`,
    ...(game.log || [])
  ].slice(0, 60);
  return next;
}
