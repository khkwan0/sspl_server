var http = require('http')
var express = require('express')
var ws = require('socket.io')
var db = require('monk')('localhost/sspl')
var ObjectId = require('mongodb').ObjectID
var bodyParser = require('body-parser')

var app = express();
var server = http.Server(app)
var io = ws(server)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))

const matches = db.collection('matches')
const games = db.collection('games')
const teams = db.collection('teams')
const players = db.collection('players')

app.get('/ping', (req, res) => {
  res.status(200).send({response: 'pong'})
})

app.post('/players', (req, res) => {
  if (typeof req.body.newPlayerName != 'undefined') {
    players.insert({playerName: req.body.newPlayerName})
    .then((result) => {
      res.status(200).send(JSON.stringify({playerId: result._id}))
    })
    .catch((err) => {
      console.log(err)
      res.status(404).send()
    })
  } else {
    res.status(404).send()
  }
})

app.get('/players/:teamId', (req, res) => {
  console.log('GET /players/' + req.params.teamId)
  if (req.params.teamId) {
    teams.find({teamId: req.params.teamId})
    .then((result) => {
      if (typeof result[0].players != 'undefined') {
        rv = []
        toPromise = []
        for (let i = 0; i < result[0].players.length; i++) {
          dbCall = players.find({_id: ObjectId(result[0].players[i])})
          toPromise.push(dbCall)
        }
        Promise.all(toPromise)   
        .then((players) => {
          res.status(200).send({players: players})
        })
        .catch((err) => {
          console.log(err)
          res.status(500).send(err)
        })
      }
    })
    .catch((err) => {
      res.status(500).send()
    })
  } else {
    res.status(404).send()
  }
})

app.get('/matches/:season', (req, res) => {
  console.log('GET /matches/'+req.params.season)
  theDate = new Date()
  theDate.setHours(0,0,0,0)

  if (req.params.season) {
    matches.find({season: parseInt(req.params.season)}, {sort: {matchDate: 1}})
    .then((matchData) => {
      if (matchData && matchData.length > 0) {
        res.status(200).send(matchData)
      } else {
        console.log('no match data')
        res.status(500).send('db err')
      }
    })
    .catch((err) => {
      console.log(err)
      res.status(500).send(err)
    })
  } else {
    console.log('no season parameter')
    res.status(404).send('err')
  }
})

app.get('/match/:matchId', (req, res) => {
  console.log('GET /match/'+req.params.matchId)
  games.find({matchId: req.params.matchId})
  .then((matchData) => {
    res.status(200).send(matchData)
  })
  .catch((err) => {
    console.log(err)
  })
})

app.post('/team/players', (req, res) => {
  console.log('POST /team/players')
  try {
    teamPlayers = req.body.players
    teamId = req.query.teamId
    season = req.query.season
    season = parseInt(season)
    console.log(teamId + ' ' + season)
    if (teamPlayers.length && season) {
      teams.findOneAndUpdate({season: season, teamId: teamId}, {$set: {players: teamPlayers}})
      .then((rv) => {
        res.status(200).send(JSON.stringify(rv))
      })
      .catch((err) => {
        console.log(err)
        res.status(500).send(err)
      })
    }
  } catch(err) {
    console.log(err)
  }
})

app.get('/teams/:season', (req, res) => {
  teams.find({season: parseInt(req.params.season)}, {sort: {teamName: 1}})
  .then((teamsData) => {
    res.status(200).send(teamsData)
  })
  .catch((err) => {
    console.log(err)
  })
})

app.post('/completeMatch/:matchId', (req, res) => {
  matches.update({matchId: req.params.matchId}, {$set : { isFinished: true}})
  .then(() => {
    res.status(200).send()
  })
  .catch((err) => {
    res.status(200).send()
  })
})

app.get('/seasondata', (req, res) => {
  seasonData = {
    season: 18,
    seasonExpireDate: new Date('2018-07-11 07:00:00')
  }
  res.status(200).send(JSON.stringify(seasonData))
})

function saveGameData(gameData) {
  games.findOneAndUpdate(
    {
      matchId: gameData.matchId,
      gameNo: gameData.gameNo
    }, gameData,
    {
      "new": true,
      "upsert": true
    }
  )
}

function checkMatchComplete(matchId) {
  return new Promise((resolve, reject) => {
    matches.find({matchId: matchId})
    .then((result) => {
      if (typeof result.homeTeamSubmit != 'undefined'
          && typeof  result.awayTeamSubmit != 'undefined'
          && result.homeTeamSubmit
          && result.awayTeamSubmit) {
        matches.update({matchId: matchId}, {$set: {isComplete: true}})
        resolve(true)
      } else {
        resolve(false)
      }
    })
    .catch((err) => {
      console.log(err)
      reject(err)
    })
  })
}

io.on('connection', function(socket) {
  socket.on('message', function(data) {
    if (typeof data.event != 'undefined') {
      if (data.event == 'join') {
        socket.join(data.data.room)
        console.log(data.data.room + 'join')
      }
      if (data.event == 'gamedata') {
        console.log('gamedata:' + data.data.room)
        console.log(data.data.gameData)
        io.to(data.data.room).emit('rcvmsg', {event: 'gamedata', data: data.data.gameData})
        saveGameData(data.data.gameData)
      }
      if (data.event == 'namequery') {
        console.log('name query: ' + data.data.name)
        query = {
          playerName: {
            $regex: data.data.name,
            $options: 'i'
          }
        }
        players.find(query)
        .then((results) => {
          console.log(results)
          socket.emit('rcvmsg', {event: 'namequery', names: results})
        })
        .catch((err) => {
          console.log(err)
        })
      }
      if (data.event == 'submitmatchdata') {
        matchId = data.data.matchid
        isConfirm = data.data.confirm
        isHome = data.data.home
        console.log('submitmatchdata: ' + data.data.room)
        io.to(data.data.room).emit('rcvmsg', {event: 'submitmatchdata', home: data.data.home, confirm: data.data.confirm})
        if (isHome) {
          matches.update({matchId: matchId}, {$set: {homeTeamSubmit: isConfirm}})
          .then(() => {
            checkMatchComplete()
            .then((isComplete) => {
              if (isComplete) {
                io.to(data.data.room).emit('rcvmsg', {event: 'matchComplete'})
              }
            })
            .catch((err) => {
              console.log(err)
            })
          })
          .catch((err) => {
            console.log(err)
          })
        } else {
          matches.update({matchId: matchId}, {$set: {awayTeamSubmit: isConfirm}})
          .then(() => {
            checkComplete()
            .then((isComplete) => {
              io.to(data.data.room).emit('rcvmsg', {event: 'matchComplete'})
            })
            .catch((err) => {
              console.log(err)
            })
          })
          .catch((err) => {
            console.log(err)
          })
        }
      }
    }
  })
})

server.listen(9988)
console.log('listening')
