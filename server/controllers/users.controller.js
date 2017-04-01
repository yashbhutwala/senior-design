import User from '../models/user';

export function createContest(username, cuid) {
    User.findOne({ username }, (err, user) => {
        if (err) {
            return cb(err);
        } else {
            user.createdContestsID.push(cuid);
            user.save();
        }
    });
}

export function joinContest(username, cuid, teamid) {
    User.findOne({ username }, (err, user) => {
        if (err) {
            return cb(err);
        } else {
            user.participatedContestsID.push({
                contest: cuid,
                team: teamid,
            });
            user.save();
        }
    });
}

export function getUserRole(req, res) {
    if (!req.params.contestId || !req.params.username) {
        res.status(403).end();
    } else {
        User.findOne({ username: req.params.username }, (err, user) => {
            if (err) {
                res.status(500).send(err);
            } else if (user === null) {
                res.status(400).send(err);
            } else if (user.createdContestsID.indexOf(req.params.contestId) !== -1) {
                res.json({ userRole: 'admin' });
            } else {
                const contest = user.participatedContestsID.find((elm) => {
                    return elm.contest === req.params.contestId;
                });
                if (contest) {
                    res.json({ userRole: 'participant', teamId: contest.team });
                } else {
                    res.json({ userRole: 'none' });
                }
            }
        });
    }
}
