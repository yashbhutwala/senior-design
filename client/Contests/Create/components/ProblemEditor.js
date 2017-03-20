import React from 'react';
import Dropzone from 'react-dropzone';
import request from 'superagent';
import { setProblemMetaData, fetchProblem } from '../../ContestActions';
import spdf from "simple-react-pdf";
import ProblemFields from './ProblemFields';

export default class ProblemEditor extends React.Component {

    constructor(props) {
        super(props);
        this.contest_id = props.params.contest_id;
        this.problem_no = props.params.problem_no;
        this.onDrop = this.onDrop.bind(this);
        this.onSave = this.onSave.bind(this);
        this.updateField = this.updateField.bind(this);
        this.state = {};
    }

    componentDidMount() {
        this.fetchProblemWrapper(this.contest_id, this.problem_no);
    }

    componentWillReceiveProps(nextProps) {
        const { contest_id, problem_no } = nextProps.params;
        if (this.problem_no !== problem_no) {
            //this.setState({})
            this.fetchProblemWrapper(contest_id, problem_no);
        }
    }

    fetchProblemWrapper(contest_id, problem_no) {
        this.contest_id = contest_id;
        this.problem_no = problem_no;
        this.setState({ pdfUrl: false, loadedPdf: false });
        fetchProblem(contest_id, problem_no).then(response => {
            if (typeof response.blob === 'function') {
                response.blob().then(blob => {
                    const pdf = new File([blob], `problem${problem_no}.pdf`);
                    const pdfUrl = URL.createObjectURL(pdf);
                    this.setState({
                        pdfUrl,
                        loadedPdf: true,
                    });
                });
            } else {
                this.setState({ err: 'Failed to load pdf' });
            }
        });
    }

    onDrop(files) {
        this.file = files[0];
        this.setState({ fileName: this.file.name });
    }

    onSave(input, output, problemName) {
        setProblemMetaData(this.contest_id, this.problem_no, {
            name:   problemName,
            input,
            output,
        }).then((res) => console.log(res));
        if (this.file) {
            var req = request.post(`/api/contests/${this.contest_id}/problem/${this.problem_no}/edit`);
            req.set('Content-Type', 'application/pdf');
            req.set('Content-Disposition', `attachment; filename=new.pdf`);
            req.attach('file', this.file);
            req.end();
        }
    }

    updateField(event) {
        const { name, value } = event.target;
        this.setState({ [name]: value });
    }

    render() {
        if (!this.state.loadedPdf) {
            return null;
        }
        const dragAndDropText = this.state.fileName ?
            `Uploaded File: ${this.state.fileName}` : 'Drag and drop pdf here or click to select files to upload.';
        const pdf = this.state.pdfUrl ?
            (<spdf.SimplePDF file={this.state.pdfUrl}/>) : null;
        return (
            <div>
                <div>
                    {pdf}
                    <Dropzone onDrop={this.onDrop} multiple={false}>
                        <div>{dragAndDropText}</div>
                    </Dropzone>
                </div>
                <ProblemFields contest_id={this.contest_id} problem_no={this.problem_no} save={this.onSave}/>
            </div>
        );
    }
}
