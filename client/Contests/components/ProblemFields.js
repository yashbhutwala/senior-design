import React from 'react';
import Dropzone from 'react-dropzone';
import Alert from 'react-s-alert';
import ConfirmationDialog from './ConfirmationDialog';
import { getProblemMetaData } from '../ContestActions';
import './problemfields.css';

export default class ProblemFields extends React.Component {

    constructor(props) {
        super(props);
        this.contestId = props.contestId;
        this.problemNum = props.problemNum;
        this.closeModal = this.closeModal.bind(this);
        this.confirmDelete = this.confirmDelete.bind(this);
        this.deleteProblem = this.deleteProblem.bind(this);
        this.onSave = this.onSave.bind(this);
        this.onDrop = this.onDrop.bind(this);
        this.getTextFromFile = this.getTextFromFile.bind(this);
        this.updateField = this.updateField.bind(this);
        this.updateInput = this.updateInput.bind(this);
        this.updateOutput = this.updateOutput.bind(this);
        this.state = {
            input: '',
            output: '',
            problemName: '',
        };
    }

    componentDidMount() {
        this.getProblemMetaDataWrapper(this.contestId, this.problemNum);
    }

    componentWillReceiveProps(nextProps) {
        this.getProblemMetaDataWrapper(nextProps.contestId, nextProps.problemNum);
    }

    closeModal() {
        this.setState({ showDialog: false });
    }

    confirmDelete() {
        this.setState({ showDialog: true });
    }

    deleteProblem() {
        this.closeModal();
        this.props.deleteProblem();
    }

    getProblemMetaDataWrapper(contestId, problemNum) {
        this.contestId = contestId;
        this.problemNum = problemNum;
        if (this.problemNum) {
            getProblemMetaData(this.contestId, this.problemNum).then((res) => {
                if (res.problemName) {
                    this.setState({
                        problemName: res.problemName,
                        input: res.input,
                        output: res.output,
                        loadedMeta: true,
                    });
                }
            });
        }
    }

    getTextFromFile(file, name) {
        const reader = new FileReader();
        reader.onload = function (event) {
            this.setState({ [name]: event.target.result });
        }.bind(this);
        reader.readAsText(file);
    }

    onDrop(files) {
        this.props.onDropFile(files);
        this.file = files[0];
        this.setState({ fileName: this.file.name });
    }

    onSave() {
        const { input, output, problemName } = this.state;
        if (0 === problemName.length) {
            Alert.warning('Cannot add problem without a name', {
                position: 'bottom-right',
                effect: 'slide',
            });
        } else if (0 === input.length || 0 === output.length) {
            Alert.warning('Please enter input or output', {
                position: 'bottom-right',
                effect: 'slide',
            });
        } else if (!this.file && !this.problemNum) {
            Alert.warning('Please upload a pdf file for the problem', {
                position: 'bottom-right',
                effect: 'slide',
            });
        } else {
            this.props.save(input, output, problemName);
        }
    }

    updateField(event) {
        const { name, value } = event.target;
        this.setState({ [name]: value });
    }

    updateInput(files) {
        this.getTextFromFile(files[0], 'input');
    }

    updateOutput(files) {
        this.getTextFromFile(files[0], 'output');
    }

    render() {
        if (!this.state.loadedMeta && this.problemNum) {
            return null;
        }
        const dragAndDropText = this.state.fileName ?
            `Uploaded File: ${this.state.fileName}` : 'Click here to upload a new problem PDF.';
        const output = 500 > this.state.output.length ? this.state.output.substring(0, 500) :
            this.state.output.substring(0, 500) + '...';
        const input = 500 > this.state.input.length ? this.state.input.substring(0, 500) :
            this.state.input.substring(0, 500) + '...';
        return (
            <div className='problem-fields col-md-6 right-col'>
                <input
                    placeholder='Problem Name'
                    name='problemName'
                    className='message-input'
                    type='text' value={this.state.problemName}
                    onChange={this.updateField}
                />
                <Dropzone
                    className='dropzone'
                    onDrop={this.updateInput}
                    multiple={false}
                >
                    Click here to upload a new input file (must be a text file)
                </Dropzone>
                <div className='file-text'>{input}</div>
                <Dropzone
                    className='dropzone'
                    onDrop={this.updateOutput}
                    multiple={false}
                >
                    Click here to upload a new output file (must be a text file)
                </Dropzone>
                <div className='file-text'>{output}</div>
                <Dropzone
                    className='pdf dropzone'
                    onDrop={this.onDrop}
                    multiple={false}
                    accept='application/pdf'
                >
                    {dragAndDropText}
                </Dropzone>
                <button className='btn save' onClick={this.onSave}>Save</button>
                {this.props.showDelete ?
                    <button
                        className='btn delete'
                        onClick={this.confirmDelete}
                    >Delete</button> : null
                }
                <ConfirmationDialog
                    showDialog={this.state.showDialog}
                    closeModal={this.closeModal}
                    confirm={this.deleteProblem}
                    confirmText='Delete'
                    isDelete
                    text='Are you sure want to delete this problem?'
                    title='Delete Problem'
                />
            </div>
        );
    }
}

ProblemFields.propTypes = {
    contestId: React.PropTypes.string.isRequired,
    problemNum: React.PropTypes.string,
    save: React.PropTypes.func.isRequired,
    deleteProblem: React.PropTypes.func,
    showDelete: React.PropTypes.bool,
    onDropFile: React.PropTypes.func.isRequired,
};
