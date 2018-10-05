import { Application } from 'probot'
import outdent from 'outdent'

export = (app: Application) => {
  app.on(
    ['issues.opened', 'issues.edited', 'issues.labeled'],
    async context => {
      app.log(context.payload)

      if (!issueHasEpicLabel(context.payload.issue)) return

      // Prevent infinite edit loop
      if (context.payload.sender.login === 'epic-generator[bot]') return

      const issueBody = context.payload.issue.body
      const metadata = getMetadata(issueBody)
      const issueNumbers = getIssueNumbers(metadata)

      if (!issueNumbers) return

      const issuesQuery = createIssuesQuery(issueNumbers)
      const results: any = await context.github.query(issuesQuery, {
        owner: context.repo().owner,
        name: context.repo().repo
      })

      if (!results) return

      const issues: any[] = Object.values(results.repository)

      // Keep metadata so that issues can easily be added/removed from epic
      const body = metadata + '\n\n' + generateEpicBody(issues)

      await context.github.issues.edit(context.issue({ body }))
    }
  )
}

function issueHasEpicLabel(issue: any) {
  return (
    issue.labels.findIndex((x: any) => x.name.toLowerCase() === 'epic') > -1
  )
}

function getMetadata(issueBody: string): string {
  const re = /(.*<!--\s+)(.*)(\s+-->.*)/
  const result = re.exec(issueBody)

  return result ? result[0] : ''
}

function getIssueNumbers(body: string): number[] {
  const issueNumbersMatch = body.match(/#[0-9_]+/g) || []

  const issueNumbers: number[] = issueNumbersMatch.map((x: string) => {
    const [_, issueNumber] = x.split('#')
    return parseInt(issueNumber, 10)
  })

  return issueNumbers
}

function generateEpicBody(issues: any[]) {
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
    | Title | Assignees | Milestone | State |
    |-|-|-|-|
    ${rows}
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
