import {readdirSync, writeFileSync} from "fs";
import * as path from "path";
import SubmissionProject from "./entities/submission-project/submission-project";
import ProjectPath from "./entities/project-path/project-path";
import ProjectPreparation from "./service/project-preparation/project-preparation";
import Server from "./service/server/server";
import PostmanRunner from "./service/postman-runner/postman-runner"
import * as collection from '../../experiment-storage/postman/collection.json'
import * as env from '../../experiment-storage/postman/environment.json'
import EslintChecker from "./service/eslint-checker/eslint-checker";
import ResultTestFailure from "./service/postman-runner/failure-test";
import SubmissionRatingGenerator from "./entities/review-result/submission-rating-generator";
import SubmissionCriteriaCheck from "./entities/review-result/submission-criteria-check/submission-criteria-check";
import backendPemulaChecklist from "./conifg/backend-pemula-checklist";
import CourseSubmissionRejection
    from "./entities/review-result/course-submission-rejection/course-submission-rejection";
import ReviewResult, {ReviewResultStatus} from "./entities/review-result/review-result";
import exceptionToReviewMessage from "./exception/exception-to-review-message";
import SubmissionErrorException from "./exception/submission-error-excepion";
import PostmanTestFailedException from "./exception/postman-test-failed-exception";
let html = `<table border="1">
    <tr>
         <td>Submission</td>
        <td>Status</td>
        <td>Rating</td>
        <td>Message</td>
        <td>Checklist</td>
    </tr>`
class Main {
    async main() {
        const allSubmission = readdirSync('../experiment-storage/project')
        let reviewResult

        for (const submission of allSubmission) {
            try {
                const submissionProject = this.createSubmissionProject(submission)
                console.log(`checking ${submission.toString()}`)

                const postmanResult = await this.runServerAndTest(submissionProject)
                const submissionCriteriaCheck = this.submissionCriteriaCheck(postmanResult)
                if (submissionCriteriaCheck.approvalStatus === false) {
                    const e = new PostmanTestFailedException('', postmanResult)
                    reviewResult = this.generateRejection(e, submissionCriteriaCheck)
                }else {
                    reviewResult = this.generateApproval(submissionProject, postmanResult, submissionCriteriaCheck)
                }
            } catch (e) {
                if (e instanceof SubmissionErrorException) {
                    reviewResult = this.generateRejection(e)
                } else {
                    console.log(e)
                }
            }

            this.showReviewResult(reviewResult, submission)
        }
        html += `</table>`
        writeFileSync('./report/index.html', html)
    }

    private showReviewResult(reviewResult: ReviewResult, submission: string) {
        console.log("status :", reviewResult.status.toString())
        console.log("rating :",reviewResult.rating)
        console.log("message :",reviewResult.message)
        console.log("unfulfilled checklist :",reviewResult.checklist)

        html += `<tr>
                    <td>${submission}</td>
                    <td>${reviewResult.status.toString()}</td>
                    <td>${reviewResult.rating}</td>
                    <td>${reviewResult.message}</td>
                    <td>${reviewResult.checklist.filter(checklist=> checklist.pass == false).map(checklist => checklist.name).join('<br>')}</td>
                </tr>`
    }

    private generateApproval(submissionProject: SubmissionProject, postmanResult: Array<ResultTestFailure>, submissionCriteriaCheck: SubmissionCriteriaCheck): ReviewResult{
        const eslintCheck = this.checkEslint(submissionProject)
        const submissionRatingGenerator = new SubmissionRatingGenerator(postmanResult, eslintCheck)
        let message = 'Congrats'
        if (!this.checkEslint(submissionProject).isSuccess){
            message = exceptionToReviewMessage[eslintCheck.code]
            if (eslintCheck.code === 'ESLINT_ERROR'){
                message += `<pre>${eslintCheck.reason}</pre>`
            }
        }

        return <ReviewResult>{
            rating: submissionRatingGenerator.rating,
            message,
            status: ReviewResultStatus.Approve,
            checklist: submissionCriteriaCheck.reviewChecklistResult
        }
    }

    private generateRejection(submissionErrorException: SubmissionErrorException, submissionCriteriaCheck?: SubmissionCriteriaCheck): ReviewResult {
        if(!submissionCriteriaCheck){
            submissionCriteriaCheck = new SubmissionCriteriaCheck(backendPemulaChecklist, [], true)
            submissionCriteriaCheck.check()
        }

        const courseSubmissionRejection = new CourseSubmissionRejection(submissionErrorException, submissionCriteriaCheck.reviewChecklistResult)
        courseSubmissionRejection.reject()


        return <ReviewResult>{
            rating: 0,
            message: courseSubmissionRejection.messages,
            status: ReviewResultStatus.Reject,
            checklist: courseSubmissionRejection.reviewChecklistResults
        }
    }

    private createSubmissionProject = (submission) => {
            const submissionPath = path.resolve('../experiment-storage/project', submission)
            const projectPath = new ProjectPath(submissionPath)
            return new SubmissionProject(projectPath, 'localhost', 5000, 'start')
    }

    private prepareSubmissionProject = (submissionProject: SubmissionProject) => {
        const projectPreparation = new ProjectPreparation(submissionProject)
        return projectPreparation.install()
    }

    private startServer = async (submissionProject: SubmissionProject) => {
        const server = new Server()
        await server.run(submissionProject)
        return server
    }

    private runPostmanTest = async () => {
        const postmanRunner = new PostmanRunner(collection, env)
        return postmanRunner.run()
    }

    private runServerAndTest = async (submissionProject: SubmissionProject) => {
            await this.prepareSubmissionProject(submissionProject)
            const server = await this.startServer(submissionProject)
            const postmanResult = await this.runPostmanTest()
            await server.stop()

            return postmanResult
    }

    private submissionCriteriaCheck = (failurePostmanTest: Array<ResultTestFailure>) => {
        const submissionCriteriaCheck = new SubmissionCriteriaCheck(backendPemulaChecklist, failurePostmanTest)
        submissionCriteriaCheck.check()

        return submissionCriteriaCheck
    }

    private checkEslint = (submissionProject: SubmissionProject) => {
        const eslintChecker = new EslintChecker(submissionProject)
        return eslintChecker.check()
    }
}

new Main().main()