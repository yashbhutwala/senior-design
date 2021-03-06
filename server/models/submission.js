import mongoose from 'mongoose';
const Schema = mongoose.Schema;

const submissionSchema = new Schema({
    cuid: { type: 'String', required: true },
    teamName: { type: 'String', required: true },
    teamID: { type: 'String', required: true },
    contestID: { type: 'String', required: true },
    problemName: { type: 'String', required: true },
    problemNumber: { type: 'Number', required: true },
    correct: { type: 'Boolean', required: true },
    hadStdError: { type: 'Boolean', required: true },
    feedback: String,
    expectedOutputFileName: String,
    actualOutputFileName: String,
    code: { type: String },
    submissionTime: Number,
    timeSinceContestStarted: Number,
});

export default mongoose.model('Submission', submissionSchema);
