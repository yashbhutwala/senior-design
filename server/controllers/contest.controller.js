import Contest, { Team } from '../models/contest';
import cuid from 'cuid';
import slug from 'limax';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs'; // for reading and writing files
import shortid from 'shortid'; // generates short filenames
import { hackerrankCall } from './hackerRank.controller';
import { createSubmission, computeScore, createTestFeedbackMessage, createFeedbackMessage } from './submission.controller';
import * as User from '../controllers/users.controller.js';

/**
 * Get all contests
 * @param req
 * @param res
 * @returns void
 */
export function getContests(req, res) {
    Contest.find().exec((err, contests) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json({ contests });
        }
    });
}

/**
 * Save a contest
 * @param req
 * @param res
 * @returns void
 */
export function createContest(req, res) {
    if (!req.body.contest.name || !req.body.contest) {
        res.status(403).end();
    } else {
        const newContest = new Contest(req.body.contest);
        newContest.name = sanitizeHtml(newContest.name);
        newContest.slug = slug(newContest.name.toLowerCase(), { lowercase: true });
        newContest.cuid = cuid();
        User.createContest(req.body.contest.admin, newContest.cuid);
        newContest.save((err, saved) => {
            if (err) {
                res.status(500).send(err);
            } else {
                res.json({ contest: saved });
            }
        });
    }
}

/**
 * Add a team to a contest
 * TODO: add password
 * @param req
 * @param res
 * @returns void
 */
export function joinContest(req, res) {
    if (!req.body.username || !req.params.contestId) {
        res.status(403).end();
    } else {
        const newTeam = new Team();
        const username = req.body.username;
        newTeam.name = sanitizeHtml(username);
        newTeam.slug = slug(newTeam.name.toLowerCase(), { lowercase: true });
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if (contest.teams.findIndex(team => team.name === newTeam.name) !== -1) {
                res.json({ err: 'TEAM_NAME_CONFLICT' });
            } else {
                const teamProblems = new Array(contest.problems.length).fill({
                    solved: false, attempFileNames: [],
                });
                newTeam.problem_attempts = teamProblems;
                contest.teams.push(newTeam);
                contest.save((err2, saved) => {
                    if (err2) {
                        res.status(500).send(err);
                    } else {
                        const team = saved.teams.pop();
                        User.joinContest(username, contest.cuid, team._id);
                        res.json({ success: true, teamId: team._id });
                    }
                });
            }
        });
    }
}

/**
 * Add a new member to a team
 * TODO: add password
 * @param req
 * @param res
 * @returns void
 */
export function addAccountToTeam(req, res) {
    if (!req.params.contestId || !req.params.teamId || !req.body.account_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }, (err, contest) => {
            if (err) {
                res.status(500).send(err);
            }
            const team = contest.teams.id(req.params.teamId);
            if (team.memberList.indexOf(req.body.account_id) === -1) {
                team.memberList.push(req.body.account_id);
                contest.save((err, saved) => {
                    if (err) {
                        res.status(500).send(err);
                    }
                    res.json({ contest: saved });
                });
            } else {
                res.json({ err: 'ACCOUNT_ALREADY_ON_TEAM' });
            }
        });
    }
}

export function readTextFile(fileName) {
    return new Promise((resolve, reject) => {
        fs.readFile(fileName, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

/**
 * Test code on HackerRank without submitting
 * @param req
 * @param res
 */
export function testProblemAttempt(req, res) {
    if (!req.params.contestId || !req.params.teamId || !req.body.problem) {
        res.status(403).end();
    } else {
    // Send query to HackerRank
        const { code, lang, testcases } = req.body.problem;
        hackerrankCall(code, lang, testcases, (error, response) => {
            let feedback;
            try {
                const { stderr, stdout, compilemessage, message, time } = JSON.parse(response.body).result;
                const hadStdError = Boolean(stderr && !stderr.every((error) => false === error));
                feedback = createTestFeedbackMessage(stderr, stdout, compilemessage, message, time, hadStdError);
                feedback = feedback.length > 250 ?
                feedback.substring(0, 250) + '... trimmed due to length' : feedback;
            } catch (err) {
                feedback = { from: 'Automated', message: 'There was an error processing your request' };
            }
            // Send feedback to team
            Contest.findOne({ cuid: req.params.contestId }, (err, contest) => {
                if (err) {
                    res.status(500).send(err);
                } else if (!contest) {
                    res.status(400).send({ err: 'Contest does not exist' });
                } else {
                    const team = contest.teams.id(req.params.teamId);
                    if (team) {
                        team.messages.push(feedback);
                        contest.save((err2) => {
                            if (err2) {
                                res.status(500).send(err);
                            } else {
                                res.json(feedback);
                            }
                        });
                    } else {
                        res.status(400).send({ err: 'Team does not exist' });
                    }
                }
            });
        });
    }
}

/**
 * Submit code and add a problem to a team
 * @param req
 * @param res
 * @returns void
 */
export function addProblemAttempt(req, res) {
    if (!req.params.contestId || !req.params.teamId || !req.body.problem) {
        res.status(403).end();
    } else {
        const { code, lang, number } = req.body.problem;
        Contest.findOne({ cuid: req.params.contestId }, (err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest || typeof contest.start !== 'number') {
                res.status(400).send(err);
            } else if (contest.closed) {
                const team = contest.teams.id(req.params.teamId);
                if (team) {
                    const feedback = 'The contest is over! No more submissions!';
                    team.messages.push({ from: 'Automated', message: feedback });
                    res.status(400).send({ err: 'Contest is closed' });
                    contest.save();
                } else {
                    res.status(400).send({ err: 'Team does not exist' });
                }
            } else {
                const team = contest.teams.id(req.params.teamId);
                if (team) {
                    const problem = team.problem_attempts[number]; // problem object of team
                    if (problem) {
                        if (problem.solved) {
                            const feedback = 'You have already solved this problem';
                            team.messages.push({ from: 'Automated', message: feedback });
                            res.status(500).send({ err: feedback });
                            contest.save();
                        } else if (problem.attempts.indexOf(code) !== -1) {
                            const feedback = 'You have already submitted this code';
                            team.messages.push({ from: 'Automated', message: feedback });
                            res.status(500).send({ err: feedback });
                            contest.save();
                        } else {
                            const fileName = contest.problems[number].fileName + '.txt';
                            readTextFile('input/' + fileName).then((input) => {
                                hackerrankCall(code, lang, [input], (error, response) => {
                                    try {
                                        if (JSON.parse(response.body).result.errors.api_key === 'The API key field is required.') {
                                            throw 'Missing API Key';
                                        }
                                        const { stderr, stdout, compilemessage, message } = JSON.parse(response.body).result;
                                        const hadStdError = Boolean(stderr && !stderr.every((error) => error === false));
                                        problem.attempts.push(code);
                                        readTextFile('output/' + fileName).then((expectedOutput) => {
                                            const stdOutput = (Array.isArray(stdout)) && stdout.length !== 0 ? stdout[0] : null;
                                            if (!hadStdError && stdOutput) { // no error => check output
                                                problem.solved = stdOutput === expectedOutput;
                                                if (problem.solved) {
                                                    team.score += computeScore(contest.start, problem.attempts.length);
                                                    team.numSolved++;
                                                    if (!contest.problems[number].solved) {
                                                        contest.problems[number].solved = true;
                                                        contest.problems[number].solvedBy = team.name;
                                                    }
                                                }
                                            }
                                            const stdError = (Array.isArray(stderr)) && stderr.length !== 0 ? stderr[0] : null;
                                            const output = hadStdError ? stdError : stdOutput || compilemessage;
                                            const actualOutputFileName = shortid.generate() + '.txt';
                                            const trimmedOutput = output.length > expectedOutput.length + 200 ?
                                                output.substring(0, expectedOutput.length + 200) + '... trimmed due to length' : output;
                                            fs.writeFile('submission/' + actualOutputFileName, trimmedOutput);
                                            const feedback = createFeedbackMessage(problem.solved, number + 1, hadStdError, stderr, compilemessage, message);
                                            team.messages.push(feedback.userFeedback);
                                            createSubmission({
                                                cuid: cuid(),
                                                teamName: team.name,
                                                teamID: req.params.teamId,
                                                contestID: req.params.contestId,
                                                problemName: contest.problems[number].name,
                                                problemNumber: number,
                                                hadStdError,
                                                correct: problem.solved,
                                                expectedOutputFileName: fileName,
                                                actualOutputFileName,
                                                feedback: feedback.judgeFeedback,
                                                code,
                                                submissionTime: Date.now(),
                                                timeSinceContestStarted: Date.now() - contest.start,
                                            });
                                            contest.save((err) => {
                                                if (err) {
                                                    res.status(500).send(err);
                                                } else {
                                                    res.json({
                                                        feedback,
                                                        correct: problem.solved,
                                                    });
                                                }
                                            });
                                        }, err => res.status(500).send(err)
                                    );
                                    } catch (err) {
                                        const feedback = 'There was an error processing your request';
                                        team.messages.push({
                                            from: 'Automated',
                                            message: feedback,
                                        });
                                        const actualOutputFileName = shortid.generate() + '.txt';
                                        fs.writeFile('submission/' + actualOutputFileName, feedback);
                                        createSubmission({
                                            cuid: cuid(),
                                            teamName: team.name,
                                            teamID: req.params.teamId,
                                            contestID: req.params.contestId,
                                            problemName: contest.problems[number].name,
                                            problemNumber: number,
                                            hadStdError: false,
                                            correct: false,
                                            expectedOutputFileName: fileName,
                                            actualOutputFileName,
                                            feedback,
                                            code,
                                            submissionTime: Date.now(),
                                            timeSinceContestStarted: Date.now() - contest.start,
                                        });
                                        contest.save(() => res.status(500).send({ err: 'error processing request' }));
                                    }
                                });
                            }, err => res.status(500).send(err)
                            );
                        }
                    } else {
                        res.status(400).send({ err: 'Invalid problem number' });
                    }
                } else {
                    res.status(400).send({ err: 'Team does not exist' });
                }
            }
        });
    }
}

/**
 * Sends the solved arrays for the contest
 * specified by id and team specified by id
 * both parameters are passed in req.params
 *
 * Response format:
 * solved:
 *      solvedInContest: [Boolean]
 *      solvedByTeam: [Boolean]
 * @param req
 * @param res
 * @returns void
 */
export function getSolvedArrays(req, res) {
    if (!req.params.contestId || !req.params.teamId) {
        res.status(403).end();
    }
    Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        } else if (!contest) {
            res.status(400).send({ err: 'Contest does not exist' });
        } else {
            const solvedInContest = contest.problems.map((problem) => problem.solved);
            const team = contest.teams.id(req.params.teamId);
            if (team) {
                const solvedByTeam = team.problem_attempts.map((problem) => problem.solved);
                res.json({ solvedInContest, solvedByTeam });
            } else {
                res.status(400).send({ err: 'Team does not exist' });
            }
        }
    });
}


export function getSolvedBy(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    }
    Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        } else if (!contest) {
            res.status(400).send({ err: 'Contest does not exist' });
        } else {
            const solvedBy = [];
            contest.problems.forEach((problem) => {
                solvedBy.push({
                    name: problem.name,
                    solvedBy: problem.solvedBy,
                });
            });
            res.json({ solvedBy });
        }
    });
}

/**
 * Sends the problem file requested
 * @param req
 * @param res
 * @returns void
 */
export function getProblemFile(req, res) {
    if (!req.params.contestId || !req.params.problem_no) {
        res.status(403).end();
    }
    const problemNum = req.params.problem_no - 1;
    Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        } else if (!contest) {
            res.status(400).send({ err: 'Contest does not exist' });
        } else if (problemNum < contest.problems.length) {
            const fileName = 'pdfs/' + contest.problems[problemNum].fileName + '.pdf';
            const file = fs.createReadStream(fileName);
            const stat = fs.statSync(fileName);
            res.setHeader('Content-Length', stat.size);
            if (fileName.endsWith('pdf')) {
                res.setHeader('Content-Type', 'application/pdf');
            } else {
                res.setHeader('Content-Type', 'application/text');
            }
            res.setHeader('Content-Disposition', `attachment; filename=problem${problemNum}.pdf`);
            file.pipe(res);
        } else {
            res.status(400).send({ err: 'Invalid problem number' });
        }
    });
}

/**
 * Creates a new problem for a contest given a pdf file
 * @param req
 * @param res
 * @returns void
 */
export function createProblem(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if ('number' === typeof contest.start) {
                res.status(400).send({ err: 'Contest already started' });
            } else {
                const fileName = shortid.generate();
                contest.problems.push({ name: fileName, fileName });
                const stream = fs.createWriteStream('pdfs/' + fileName + '.pdf');
                stream.on('open', () => {
                    req.pipe(stream);
                    contest.save(() => {
                        res.json({ problemNo: contest.problems.length });
                    });
                });
            }
        });
    }
}

/**
 * Deletes a problem for a contest given a problem number
 * Will not delete if contest started
 * @param req
 * @param res
 * @returns void
 */
export function deleteProblem(req, res) {
    if (!req.params.contestId || !req.params.problemNum) {
        res.status(403).end();
    } else {
        const problemNum = req.params.problemNum - 1;
        Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if ('number' === typeof contest.start) {
                res.status(400).send({ err: 'Contest already started' });
            } else if (problemNum < contest.problems.length) {
                contest.problems.splice(problemNum, 1);
                contest.save((err2) => {
                    if (err2) {
                        res.status(500).send(err2);
                    } else {
                        res.json({ success: true });
                    }
                });
            } else {
                res.status(400).send({ err: 'Invalid problem number' });
            }
        });
    }
}

/**
 * Changes problem pdf file
 * @param req
 * @param res
 * @returns void
 */
export function changeProblemPdf(req, res) {
    if (!req.params.contestId || !req.params.problem_no) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no - 1;
        Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                if (problem_no < contest.problems.length) {
                    const fileName = 'pdfs/' + contest.problems[problem_no].fileName + '.pdf';
                    const stream = fs.createWriteStream(fileName);
                    stream.on('open', () => {
                        req.pipe(stream);
                        contest.save(() => {
                            res.json({ success: true });
                        });
                    });
                } else {
                    res.json({ err: `Invalid problem number: ${problem_no}` });
                }
            }
        });
    }
}

/**
 * Sets the problem meta data
 * @param req
 * @param res
 * @returns void
 */
export function setProblemMetaData(req, res) {
    if (!req.params.contestId || !req.params.problem_no || !req.body.metadata) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no - 1;
        Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                if (problem_no < contest.problems.length) {
                    const { input, output } = req.body.metadata;
                    contest.problems[problem_no].name = req.body.metadata.name;
                    const fileName = contest.problems[problem_no].fileName + '.txt';
                    fs.writeFile('input/' + fileName, input, (err) => {
                        if (err) {
                            res.status(500).send(err);
                        } else {
                            fs.writeFile('output/' + fileName, output, (err2) => {
                                if (err2) {
                                    res.status(500).send(err);
                                } else {
                                    contest.save((err3) => {
                                        if (err3) {
                                            res.status(500).send(err);
                                        } else {
                                            res.json({ success: 'true' });
                                        }
                                    });
                                }
                            });
                        }
                    });
                } else {
                    res.json({ err: `Invalid problem number: ${problem_no}` });
                }
            }
        });
    }
}

/**
 * Gets the problem meta data
 * @param req
 * @param res
 * @returns void
 */
export function getProblemMetaData(req, res) {
    if (!req.params.contestId || !req.params.problem_no) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no - 1;
        Contest.findOne({ cuid: req.params.contestId }).select('problems').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if (problem_no < contest.problems.length) {
                const fileName = contest.problems[problem_no].fileName + '.txt';
                readTextFile('input/' + fileName).then((input) => {
                    readTextFile('output/' + fileName).then((output) => {
                        res.json({
                            problemName: contest.problems[problem_no].name,
                            input,
                            output,
                        });
                    }, err => res.status(500).send(err)
                    );
                }, err => res.status(500).send(err)
                );
            } else {
                res.json({ err: `Invalid problem number: ${problem_no}` });
            }
        });
    }
}

/**
 * Get a single contest
 * @param req
 * @param res
 * @returns void
 */
export function getContest(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                res.json({ contest });
            }
        });
    }
}

/**
 * Get the info for the contest home page
 * @param req
 * @param res
 * @returns void
 */
export function getContestInfo(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId })
        .select('about admin closed name rules start')
        .exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                const open = 'number' === typeof contest.start;
                const { about, admin, closed, name, rules } = contest;
                res.json({ about, admin, closed, name, open, rules });
            }
        });
    }
}

/**
 * Update the info for the contest home page
 * @param req
 * @param res
 * @returns void
 */
export function updateContestInfo(req, res) {
    if (!req.params.contestId || !req.body.info) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId })
        .select('about name rules')
        .exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if (typeof contest.start === 'number') {
                res.status(400).send({ err: 'Contest already started' });
            } else {
                contest.about = req.body.info.about;
                contest.name = req.body.info.name;
                contest.rules = req.body.info.rules;
                contest.save((err, saved) => {
                    if (err) {
                        res.status(500).send(err);
                    } else {
                        res.json({ success: true });
                    }
                });
            }
        });
    }
}


/**
 * Get the number of problems in a specified contest
 * @param req
 * @param res
 * @returns void
 */
export function getNumberOfProblems(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).select('problems start').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                res.json({
                    numberOfProblems: contest.problems.length,
                    started: 'number' === typeof contest.start,
                });
            }
        });
    }
}

/**
 * Sets the start time of the contest
 * @param req
 * @param res
 * @returns void
 */
export function openContest(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else if (0 === contest.problems.length) {
                res.json({ success: false });
            } else if (!contest.start) {
                contest.start = Date.now();
                contest.save((err) => {
                    if (err) {
                        res.status(500).send(err);
                    } else {
                        res.json({ success: true });
                    }
                });
            } else {
                res.status(400).send({ err: 'Contest already started' });
            }
        });
    }
}

/**
 * Stops the contest, no problem attempts can be added after this request
 * @param req
 * @param res
 * @returns void
 */
export function closeContest(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                contest.closed = true;
                contest.teams.forEach(team => {
                    team.messages.push({
                        from: 'Judges',
                        message: 'Broadcast: The contest is closed. Submissions will no longer be accepted.',
                    });
                });
                contest.broadcastMessages.push({
                    from: 'Judges',
                    message: 'The contest is closed. Submissions will no longer be accepted.',
                });
                contest.save((err) => {
                    if (err) {
                        res.status(500).send(err);
                    } else {
                        res.json({ success: true });
                    }
                });
            }
        });
    }
}

/**
 * Sends an array of teams
 *
 * Response format:
 * teams:
 *      teamNames: [Strings]
 *      teamScores: [Numbers]
 *      teamNumSolved: [Numbers]
 * @param req
 * @param res
 * @returns void
 */
export function getTeamScores(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).select('teams scoreboardVisible').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                const teamNames = new Array(contest.teams.length);
                const teamScores = new Array(contest.teams.length);
                const teamNumSolved = new Array(contest.teams.length);
                contest.teams.forEach((team, index) => {
                    teamNames[index] = team.name;
                    teamScores[index] = team.score;
                    teamNumSolved[index] = team.numSolved;
                });
                res.json({
                    teamNames,
                    teamScores,
                    teamNumSolved,
                    scoreboardVisible: contest.scoreboardVisible,
                });
            }
        });
    }
}

/**
 * Toggles the scoreboard visibility
 * @param req
 * @param res
 * @returns void
 */
export function hideScoreboard(req, res) {
    if (!req.params.contestId) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                contest.scoreboardVisible = false;
                contest.save((err) => {
                    if (err) {
                        res.status(500).send(err);
                    } else {
                        res.json({ success: true });
                    }
                });
            }
        });
    }
}

/**
 * Toggles the scoreboard visibility
 * @param req
 * @param res
 * @returns void
 */
export function showScoreboard(req, res) {
    if (!req.params.contestId) {
        res.status(400).end();
    } else {
        Contest.findOne({ cuid: req.params.contestId }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else if (!contest) {
                res.status(400).send({ err: 'Contest does not exist' });
            } else {
                contest.scoreboardVisible = true;
                contest.save((err, saved) => {
                    if (err) {
                        res.status(500).send(err);
                    } else {
                        res.json({ success: true });
                    }
                });
            }
        });
    }
}

/**
 * Get all contest that match an array of IDs
 * Used to display list of my contests
 * @param req
 * @param res
 * @returns void
 */
export function getContestsFromIds(req, res) {
    Contest.find({ cuid: { $in: req.params.cuids } }).select('name cuid slug start').exec((err, contests) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json({ contests });
        }
    });
}

/**
 * Get all contest that do not match any of an array of IDs
 * Used to display list of contests to join
 * @param req
 * @param res
 * @returns void
 */
export function getContestsNotInIds(req, res) {
    Contest.find({ cuid: { $nin: req.params.cuids } }).select('name cuid slug start').exec((err, contests) => {
        if (err) {
            res.status(500).send(err);
        } else {
            res.json({ contests });
        }
    });
}

/**
 * Delete a contest
 * @param req
 * @param res
 * @returns void
 */
export function deleteContest(req, res) {
    Contest.findOne({ cuid: req.params.cuid }).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        } else if (!contest) {
            res.status(400).send({ err: 'Contest does not exist' });
        } else {
            contest.remove(() => {
                res.status(200).end();
            });
        }
    });
}
