import express from 'express';
import { createServer } from 'http';
import { Server as SocketIo } from 'socket.io';
import open from 'open';
import path from 'path';
import { fileURLToPath } from 'url';
import { LiveGames } from './classes/liveGames.js';
import { Players } from './classes/players.js';
import { readquizInfo, writequizInfo, getQuestionsForGame} from '../utils/jsonStorage.mjs';
import { registerUserJson, authenticateUserJson } from '../utils/jsonUserStorage.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const server = createServer(app);
const io = new SocketIo(server);

const games = new LiveGames();
const players = new Players();
const PORT = 3000;

const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('register', async (data) => {
        const { username, password, accountType } = data;
        const registrationSuccess = await registerUserJson(username, password, accountType);
        if (registrationSuccess) {
            socket.emit('registrationSuccess', 'User registered successfully');
        } else {
            socket.emit('registrationFailed', 'Registration failed or username already exists');
        }
    });

    // Add user login handling
    socket.on('login', async (data) => {
        const { username, password } = data;
        const isAuthenticated = await authenticateUserJson(username, password);
        if (isAuthenticated) {
            socket.emit('loginSuccess', 'Login successful');
        } else {
            socket.emit('loginFailed', 'Invalid username or password');
        }
    });

    console.log('A user connected');

    //---host logic---//
    socket.on('hostJoin', async (data) => {
        const quizzes = await readquizInfo();
        const quiz = quizzes.find(q => q.id === parseInt(data.id));
        if (quiz) {
            var gamePin = quiz.gamePin;
            games.addGame(gamePin, socket.id, false, {responses: 0, questionLive: false, gameid: data.id, question: 1});
            var game = games.findGameByHostId(socket.id);
            socket.join(game.pin);
            console.log('Game Created with pin:', game.pin);
            socket.emit('showPin', {pin: game.pin});
        } else {
            socket.emit('noGame');
        }
    });

    //currently working on getting game sent to all players (host starting but not others)
    socket.on('hostJoinGame', async (data) => {
        const game = games.findGameByHostId(data.id);
        if (game) {
            game.hostId = socket.id;
            socket.join(game.pin);
            
            // Retrieve questions for the game
            const questions = await getQuestionsForGame(game.quizInfo.gameid);
            
            if (questions.length > 0) {
                console.log("long enough");
                socket.emit('quizQuestions', {
                    questions: questions.map(q => ({
                        question: q.question,
                        answers: q.answers,
                        correct: q.correct
                    })),
                    playersInGame: players.getPlayers(game.hostId).length
                });
    
                game.quizInfo.questionLive = true;
                io.to(game.pin).emit('startForPlayer');
            } else {
                socket.emit('error', 'No questions available for this game');
            }
        } else {
            socket.emit('noGame');
        }
    });
    
    


    //---player joining logic---//
    socket.on('playerJoinGame', params => {
        // Validate the provided pin before attempting to join the room
        if (!params.pin) {
            console.error("Invalid or missing pin provided by the user.");
            socket.emit('error', 'Invalid game pin');
            return;
        }
    
        console.log("About to join room with pin:", params.pin);
    
        // Use the find method to search for the game by pin
        const game = games.getGameByPin(params.pin.toString()); // Convert to string if not already
        console.log("game contents: ");
        console.log(game);
        if (game) {
            console.log("game exists!");
            try {
                // Add player to the game
                players.addPlayer(game.hostId, socket.id, params.name, { score: 0, answer: 0 });
                console.log("player added to list of players!");
            } catch (error) {
                console.error("Error adding player:", error);
                socket.emit('error', 'Failed to add player');
                return;
            }
    
            // Ensure the socket is connected before joining the room
            if (!socket.connected) {
                console.log("Socket is not connected, cannot join room.");
                socket.emit('error', 'Socket not connected');
                return;
            }

            console.log("socket is connected!");
    
            // Player joins the socket room associated with the game pin
            socket.join(params.pin);
            console.log("Joined room successfully with pin:", params.pin);
            
            // Retrieve all players in this game
            const playersInGame = players.getPlayers(game.hostId);
            
            // Update the player lobby with the current list of players
            io.to(params.pin).emit('updateLobbyCount', playersInGame);
        } else {
            console.log("this is user inputed pin: ", params.pin);
            console.log("Detailed games object:", JSON.stringify(games, null, 2));
            console.log('No game found with pin:', params.pin);
            socket.emit('noGame');
        }
    });
    
    
    socket.on('playerJoinGame-game', async (data) => {
        const player = players.getPlayer(data.id);
        if (player) {
            console.log("player contents: ");
            console.log(player);
            console.log("game contents: ");
            console.log(games);
            const game = games.findGameByHostId(player.hostId);
            console.log("this is game: ", game);
            socket.join(game.pin);
            player.playerId = socket.id;
            const playersInGame = players.getPlayers(game.hostId);
            socket.emit('playerDataInGame', playersInGame);
        } else {
            socket.emit('noGame');
        }
    });
    

    //----disconnecting from game logic---//
    socket.on('disconnect', async () => {
        const games = await readquizInfo();
        const player = players.getPlayer(socket.id);

        console.log("this is games: ");
        console.log(games);
    
        if (player) {
            console.log("Player details:", player);
            const game = games.findGameByHostId(player.playerId);
            if (game) {
                if (!game.gameLive) {
                    games.splice(games.indexOf(game), 1);
                    await writequizInfo(games);
                    console.log('Game ended with pin:', game.pin);
                    game.players.forEach(p => {
                        players.removePlayer(p.id);
                    });
                    io.to(game.pin).emit('hostExit');
                    socket.leave(game.pin);
                } else {
                    // Handle active game scenario
                    players.removePlayer(socket.id);
                    const playersInGame = players.getPlayers(player.hostId);
                    io.to(game.pin).emit('updateLobbyCount', playersInGame);
                    socket.leave(game.pin);
                }
            } else {
                console.log('No game found for host ID:', player.hostId);
            }
        } else {
            console.log('No player found for socket ID:', socket.id);
        }
    });
    
    


    //---handling answers logic---//
    socket.on('playerResponse', async (num) => {
        const player = players.getPlayer(socket.id);
        const game = games.findGameByHostId(player.hostId);
        if (game.quizInfo.questionLive) {
            player.quizInfo.answer = num;
            game.quizInfo.responses += 1;
            const correctAnswer = game.questions[game.quizInfo.question - 1].correct;
            if (num === correctAnswer) {
                player.quizInfo.score += 100;
                io.to(game.pin).emit('getTime', socket.id);
                socket.emit('result', true);
            }
            if (game.quizInfo.responses === game.players.length) {
                game.quizInfo.questionLive = false;
                await writequizInfo(games);  // Update the game state
                io.to(game.pin).emit('questionOver', game.players, correctAnswer);
            } else {
                io.to(game.pin).emit('updatePlayer', {
                    playersInGame: game.players.length,
                    responses: game.quizInfo.responses
                });
            }
        }
    });

    //---retrieving user score logic---//
    socket.on('getScore', function() {
        const player = players.getPlayer(socket.id);
        if (player) {
            socket.emit('newScore', player.quizInfo.score);
        }
    });
    
    //---logic for handling time---//
    socket.on('time', function(data) {
        const player = players.getPlayer(data.player);
        if (player) {
            const time = data.time / 20 * 100;
            player.quizInfo.score += time;
            // Ensure to write game data changes to the JSON
            writequizInfo(players.getAllPlayers());  // Assuming you have a method to retrieve all player data
        }
    });
    socket.on('timeUp', async function() {
        const game = games.findGameByHostId(socket.id);
        if (game && game.quizInfo.questionLive) {
            game.quizInfo.questionLive = false;
            const question = game.questions[game.quizInfo.question - 1];
            const correctAnswer = question.correct;
            io.to(game.pin).emit('questionOver', players.getPlayers(game.hostId), correctAnswer);
            await writequizInfo(games); // Save any state changes
        }
    });
    
    //---logic for getting next question---//
    socket.on('nextQuestion', async function() {
        const games = await readquizInfo();
        const game = games.find(g => g.hostId === socket.id);
        if (game && game.questions.length > game.quizInfo.question) {
            game.quizInfo.questionLive = true;
            game.quizInfo.responses = 0;
            game.quizInfo.question += 1;
            
            const currentQuestion = game.questions[game.quizInfo.question - 1];
            socket.emit('quizQuestions', {
                q1: currentQuestion.question,
                a1: currentQuestion.answers[0],
                a2: currentQuestion.answers[1],
                a3: currentQuestion.answers[2],
                a4: currentQuestion.answers[3],
                correct: currentQuestion.correct,
                playersInGame: players.getPlayers(game.hostId).length
            });
    
            await writequizInfo(games);
        } else {
            // Handle end of quiz
            const playersInGame = players.getPlayers(game.hostId);
            // Sort and get top scores
            playersInGame.sort((a, b) => b.quizInfo.score - a.quizInfo.score);
            io.to(game.pin).emit('GameOver', playersInGame.slice(0, 5).map((p, i) => ({
                name: p.name,
                score: p.quizInfo.score
            })));
        }
        io.to(game.pin).emit('getNextQuestion');
    });
    
    //When the host starts the game
    socket.on('startGame', () => {
        var game = games.findGameByHostId(socket.id);//Get the game based on socket.id
        game.gameLive = true;
        console.log("game is being started on the server side");
        socket.emit('gameStarted', game.hostId);//Tell player and host that game has started
    });
    
    //---logic for getting database contents---//
    socket.on('getdbname', async function() {
        const games = await readquizInfo();
        socket.emit('gameNamesData', games.map(g => ({ id: g.id, name: g.name })));
    });


    //---other events---//
    socket.on('someEvent', async () => {
        const games = await readquizInfo();
        const game = games.find(game => game.hostId === socket.id || (Array.isArray(game.players) && game.players.some(p => p.id === socket.id)));
    
        if (game) {
            // Check if the current socket is the host of the game
            if (game.hostId === socket.id) {
                console.log("Host has triggered the event.");
                socket.emit('hostConfirmed', { message: "You are the host of this game.", gameId: game.id });
            } else {
                // If not the host, then the socket must be one of the players
                console.log("Player has triggered the event.");
                const player = game.players.find(p => p.id === socket.id);
                if (player) {
                    socket.emit('playerConfirmed', { message: "You are a player in this game.", gameId: game.id, playerName: player.name });
                } else {
                    // This should theoretically never happen since we check this in the find condition
                    socket.emit('error', { message: "Player data not found." });
                }
            }
        } else {
            console.log("No game found for this user.");
            socket.emit('error', { message: "You are not part of any game." });
        }
    });
    
    
    
    //---new quiz logic---//
    socket.on('newQuiz', async (data) => {
        const games = await readquizInfo();
        data.id = games.length + 1; // Simple auto-increment
        console.log("this is quiz content: ", data);
        games.push(data);
        await writequizInfo(games);
        socket.emit('startNewGame', data.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    open(`http://localhost:${PORT}`).catch((error) => {
        console.error('Failed to open the browser:', error);
    });
});
