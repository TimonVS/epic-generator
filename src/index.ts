import { Application } from 'probot'
import outdent from 'outdent'

const dataRe = /(?<=<!-- EPIC:DATA\s+).*?(?=\s+-->)/gs
const tableRe = /(<!-- EPIC:START -->\s+).*?(\s+<!-- EPIC:END -->)/gs

export = (app: Application) => {
  app.on(
    ['issues.opened', 'issues.edited', 'issues.labeled'],
    async context => {
      app.log(context.payload)

      if (!issueHasEpicLabel(context.payload.issue)) return

      // Prevent infinite edit loop
      if (context.payload.sender.login === 'epic-generator[bot]') return

      const issueBody: string = context.payload.issue.body
      const issueNumbers = getIssueNumbers(issueBody)
      const hasEpicTable = issueBody.search(tableRe) > -1

      // Remove epic table if there are no issue numbers found
      if (issueNumbers.length === 0 && hasEpicTable) {
        await context.github.issues.edit(
          context.issue({ body: issueBody.replace(tableRe, '') })
        )

        return
      }

      const issuesQuery = createIssuesQuery(issueNumbers)
      const results: any = await context.github.query(issuesQuery, {
        owner: context.repo().owner,
        name: context.repo().repo
      })

      if (!results) return

      const issues: any[] = Object.values(results.repository)
      const epicTable = generateEpicTable(issues)

      if (hasEpicTable) {
        await context.github.issues.edit(
          context.issue({ body: issueBody.replace(tableRe, epicTable) })
        )
      } else {
        await context.github.issues.edit(
          context.issue({
            body: issueBody + '\n\n' + epicTable
          })
        )
      }
    }
  )
}

function issueHasEpicLabel(issue: any) {
  return (
    issue.labels.findIndex((x: any) => x.name.toLowerCase() === 'epic') > -1
  )
}

function getIssueNumbers(issueBody: string): number[] {
  const matches = issueBody.match(dataRe)
  const metadata = matches ? matches[0] : ''

  const issueNumbersMatch = metadata.match(/#[0-9_]+/g) || []

  const issueNumbers: number[] = issueNumbersMatch.map((x: string) => {
    const [_, issueNumber] = x.split('#')
    return parseInt(issueNumber, 10)
  })

  return issueNumbers
}

function generateEpicTable(issues: any[]) {
  const rows = issues
    .map((issue: any) => {
      const data = [
        `[${issue.title}](${issue.url})`,
        issue.assignees.nodes.join(', '),
        issue.milestone && `[${issue.milestone.title}](${issue.milestone.url})`,
        capitalizeFirstLetter(issue.state.toLowerCase())
      ].map(x => (!!x ? x : 'N/A'))

      return `| ${data.join(' | ')} |`
    })
    .join('\n')

  const table = outdent`
    <!-- EPIC:START -->
    | Title | Assignees | Milestone | State |
    |-|-|-|-|
    ${rows}
    <!-- EPIC:END -->
    `

  return table
}

function createIssuesQuery(issues: number[]) {
  const query = `
    query issues($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        ${issues.map(
          x => `issue${x}: issue(number: ${x}) {
          ...IssueInfo
        }`
        )}
      }
    }
    fragment IssueInfo on Issue {
      number
      title
      state
      url
      assignees(first: 2) {
        nodes {
          name
        }
      }
      milestone {
        title
        url
      }
    }
  `

  return query
}

function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1)
}
