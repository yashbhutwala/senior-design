import Contest, { Team } from '../models/contest';
import cuid from 'cuid';
import slug from 'limax';
import sanitizeHtml from 'sanitize-html';
import fs from 'fs'; // for reading and writing files
import shortid from 'shortid'; // generates short filenames
import {hackerrankCall} from './hackerRank.controller';
import {createSubmission, computeScore, createFeedbackMessage} from './submission.controller';
import authenticate from '../middlewares/authenticate';

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
export function addTeamToContest(req, res) {
    if (!req.body.team.name || !req.params.contest_id || !req.body.team.memberList) {
        res.status(403).end();
    }

    const newTeam = new Team(req.body.team);

    // Let's sanitize inputs
    newTeam.name = sanitizeHtml(newTeam.name);
    newTeam.slug = slug(newTeam.name.toLowerCase(), { lowercase: true });
    let teamNameConflict = false;
    Contest.findOne({cuid: req.params.contest_id}).select('teams').exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        }
        if (contest.teams.findIndex(team => team.name === newTeam.name) !== -1) {
            res.json({ err: 'TEAM_NAME_CONFLICT'});
        } else {
            const teamProblems = Array(contest.problems.length).fill({
              solved: false, attempFileNames: []
            });
            newTeam.problem_attempts = teamProblems;
            contest.teams.push(newTeam);
            contest.save((err, saved) => {
                if (err) {
                    res.status(500).send(err);
                }
                //console.log(saved);
                res.json({ team: saved });
            });
        }
    });
}

/**
 * Add a new member to a team
 * TODO: add password
 * @param req
 * @param res
 * @returns void
 */
export function addAccountToTeam(req, res) {
    if (!req.params.contest_id || !req.params.team_id || !req.body.account_id) {
        res.status(403).end();
    } else {
        Contest.findOne({cuid: req.params.contest_id}, (err, contest) => {
            if (err) {
                res.status(500).send(err);
            }
            const team = contest.teams.id(req.params.team_id);
            if (team.memberList.indexOf(req.body.account_id) == -1) {
                team.memberList.push(req.body.account_id);
                contest.save((err, saved) => {
                    if (err) {
                        res.status(500).send(err);
                    }
                    res.json({ contest: saved });
                })
            } else {
                res.json({ err: 'ACCOUNT_ALREADY_ON_TEAM'});
            }
        });
    }
}

function readTextFile(fileName) {
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
 * Add a problem to a team
 * @param req
 * @param res
 * @returns void
 */
export function addProblemAttempt(req, res) {
    if (!req.params.contest_id || !req.params.team_id || !req.body.problem) {
        res.status(403).end();
    } else {
        const {number, code, lang} = req.body.problem;
        Contest.findOne({cuid: req.params.contest_id}, (err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else {
                const team = contest.teams.id(req.params.team_id);
                const problem = team.problem_attempts[number]; // problem object of team
                if (problem.solved) {
                    const feedBack = 'You have already solved this problem';
                    team.messages.push({ from: 'Automated', message: feedBack});
                    res.status(500).send({err: feedBack});
                    contest.save();
                } else if (problem.attempts.indexOf(code) != -1) {
                    const feedBack = 'You have already submitted this code';
                    team.messages.push({ from: 'Automated', message: feedBack});
                    res.status(500).send({err: feedBack});
                    contest.save();
                } else {
                    const fileName = contest.problems[problem_no].fileName + '.txt';
                    readTextFile('input/' + fileName).then((input) => {
                        hackerrankCall(code, lang, input, (error, response) => {
                            const {stderr, stdout, compilemessage} = JSON.parse(response.body).result;
                            const hadStdError = stderr != null && !stderr.every((error) => error == false);
                            problem.attempts.push(code);
                            readTextFile('output/' + fileName).then((expectedOutput) => {
                                if (!hadStdError && stdout != null) { // no error => check output
                                    problem.solved = true;
                                    if (stdout.length === expectedOutput.length) {
                                        for (let i = 0; i < stdout.length; i++) {
                                            if (stdout[i] != expectedOutput[i]) {
                                                problem.solved = false;
                                                break;
                                            }
                                        }
                                    }
                                    if (problem.solved) {
                                        team.score += computeScore(contest.start, problem.attempts.length);
                                        team.numSolved++;
                                        if(!contest.problems[number].solved) {
                                            contest.problems[number].solved = true;
                                            contest.problems[number].solvedBy = req.params.team_id;
                                        }
                                    }
                                }
                                const output = hadStdError ? stderr : stdout || [compilemessage];
                                const feedBack = createFeedbackMessage(problem.solved, compilemessage, number, hadStdError, stderr);
                                team.messages.push(feedBack);
                                createSubmission({
                                    cuid: cuid(),
                                    teamName: team.name,
                                    teamID: req.params.team_id,
                                    contestID: req.params.contest_id,
                                    problemName: contest.problems[number].name,
                                    problemNumber: number,
                                    hadStdError,
                                    correct: problem.solved,
                                    actualOutput: output,
                                });
                                contest.save((err, saved) => {
                                    if (err) {
                                        res.status(500).send(err);
                                    } else {
                                        res.json({
                                            feedBack,
                                            correct: problem.solved,
                                        });
                                    }
                                });
                            }, err => res.status(500).send(err)
                            );
                        });
                    }, err => res.status(500).send(err)
                    );
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
    if (!req.params.contest_id || !req.params.team_id) {
        res.status(403).end();
    }
    Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        }
        const solvedInContest = contest.problems.map((problem) => problem.solved);
        const team = contest.teams.id(req.params.team_id);
        const solvedByTeam = team.problem_attempts.map((problem) => problem.solved);
        res.json({ solved: {solvedInContest, solvedByTeam}});
    });
}

/**
 * Sends the problem file requested
 * @param req
 * @param res
 * @returns void
 */
export function getProblemFile(req, res) {
    if (!req.params.contest_id || !req.params.problem_no) {
        res.status(403).end();
    }
    const problem_no = req.params.problem_no - 1;
    Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        }
        if (problem_no < contest.problems.length) {
            const fileName = 'pdfs/' + contest.problems[problem_no].fileName + '.pdf';
            const file = fs.createReadStream(fileName);
            const stat = fs.statSync(fileName);
            res.setHeader('Content-Length', stat.size);
            if(fileName.endsWith('pdf')) {
                res.setHeader('Content-Type', 'application/pdf');
            } else {
                res.setHeader('Content-Type', 'application/text');
            }
            res.setHeader('Content-Disposition', `attachment; filename=problem${problem_no}.pdf`);
            file.pipe(res);
        } else {
            res.json({err: 'Invalid problem number'});
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
    if (!req.params.contest_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
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
 * Changes problem pdf file
 * @param req
 * @param res
 * @returns void
 */
export function changeProblemPdf(req, res) {
    if (!req.params.contest_id || !req.params.problem_no) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no;
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
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
                    res.json({ err: 'Invalid problem number' });
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
    if (!req.params.contest_id || !req.params.problem_no || !req.body.metadata) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no - 1;
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else {
                if (problem_no < contest.problems.length) {
                    const {input, output} = req.body.metadata;
                    contest.problems[problem_no].name = req.body.metadata.name;
                    const fileName = contest.problems[problem_no].fileName + '.txt';
                    fs.writeFile('input/' + fileName, input, function(err) {
                        if (err) {
                            res.status(500).send(err);
                        } else {
                            fs.writeFile('output/' + fileName, output, function(err) {
                                if (err) {
                                    res.status(500).send(err);
                                } else {
                                    contest.save((err, contest) => {
                                        if (err) {
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
    if (!req.params.contest_id || !req.params.problem_no) {
        res.status(403).end();
    } else {
        const problem_no = req.params.problem_no - 1;
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            }
            if (problem_no < contest.problems.length) {
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
                res.json({ err: 'Invalid problem number' });
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
    if (!req.params.contest_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else {
                res.json({ contest });
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
    if (!req.params.contest_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err || !contest) {
                res.status(500).send(err);
            } else {
                res.json({ numberOfProblems: contest.problems.length });
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
export function startContest(req, res) {
    if (!req.params.contest_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contest_id }).exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else {
                contest.start = Date.now();
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
    if (!req.params.contest_id) {
        res.status(403).end();
    } else {
        Contest.findOne({ cuid: req.params.contest_id }).select('teams').exec((err, contest) => {
            if (err) {
                res.status(500).send(err);
            } else {
                const teamNames = Array(contest.teams.length);
                const teamScores = Array(contest.teams.length);
                const teamNumSolved = Array(contest.teams.length);
                contest.teams.forEach((team, index) => {
                    teamNames[index] = team.name;
                    teamScores[index] = team.score;
                    teamNumSolved[index] = team.numSolved;
                });
                res.json({ teams: {teamNames, teamScores, teamNumSolved } });
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
    if (!req.params.contest_id) {
        res.status(403).end();
    }

    Contest.findOne({cuid: req.params.contest_id}).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        }
        contest.scoreboardVisible = false;
        contest.save((err, saved) => {
            if (err) {
                res.status(500).send(err);
            }
            res.json({ success: true });
        });
    });
}

/**
 * Toggles the scoreboard visibility
 * @param req
 * @param res
 * @returns void
 */
export function showScoreboard(req, res) {
    if (!req.params.contest_id) {
        res.status(403).end();
    }

    Contest.findOne({cuid: req.params.contest_id}).exec((err, contest) => {
        if (err) {
            res.status(500).send(err);
        }
        contest.scoreboardVisible = true;
        contest.save((err, saved) => {
            if (err) {
                res.status(500).send(err);
            }
            res.json({ success: true });
        });
    });
}

/**
 * Get all contest that match an array of IDs
 * Used to display list of my contests
 * @param req
 * @param res
 * @returns void
 */
export function getContestsFromIds(req, res) {
    Contest.find({ cuid: {$in: req.params.cuids }}).select('name cuid slug start').exec((err, contests) => {
        if (err) {
            res.status(500).send(err);
        }
        res.json({ contests });
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
    Contest.find({ cuid: {$nin: req.params.cuids }}).select('name cuid slug start').exec((err, contests) => {
        if (err) {
            res.status(500).send(err);
        }
        res.json({ contests });
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
    }
    contest.remove(() => {
      res.status(200).end();
    });
  });
}
