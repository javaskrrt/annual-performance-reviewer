# @javaskrrt/annual-performance-reviewer

Overwhelmed by the idea of completing your annual performance review as a software engineer?

Let your git commits do the talking! This CLI tool analyzes your git history across all your repositories and uses AI to generate comprehensive performance review insights.

## What it does

This tool scans all git repositories in a directory, extracts your commit history, and uses OpenAI's GPT model to synthesize your contributions into structured performance review content. It identifies patterns, summarizes achievements, and helps you articulate your technical impact over the review period.

## Features

- 🔍 **Multi-repository scanning** - Analyzes all git repos in a target directory
- 📧 **Email filtering** - Filter commits by git author email(s) for multi-account workflows
- 🤖 **AI-powered analysis** - Uses OpenAI to generate meaningful insights from raw commit data
- 📝 **Performance review ready** - Outputs formatted content suitable for annual reviews
- ⚡ **Fast and efficient** - Built with Bun for optimal performance

## Prerequisites

- An OpenAI API key (set as `OPENAI_API_KEY` environment variable)
- Git repositories with commit history
- Node.js or Bun runtime

## How to use

1. Navigate to the directory where all of your projects live (e.g., `~/Code` or `~/projects`)
2. Run the command:
   ```bash
   npx @javaskrrt/annual-performance-reviewer
   ```
3. You will be prompted to:
   - Choose which email(s) you'd like to filter by (helpful for if you've contributed across multiple repos using different git accounts/emails)
   - Confirm your selection
4. The tool will:
   - Scan all subdirectories for git repositories
   - Extract commits matching your selected email(s)
   - Send the commit data to OpenAI for analysis
   - Display the generated performance review insights

## Output

The script will run an analysis on all of your git commits, synthesizing all of this information into simple answers that you can use in your annual performance review assessment. The output includes summaries of your technical contributions, project impact, and areas of growth.

## Configuration

Set your OpenAI API key as an environment variable:
```bash
export OPENAI_API_KEY="your-api-key-here"
```

Or create a `.env` file in your working directory (Bun automatically loads it):
```
OPENAI_API_KEY=your-api-key-here
```

## Development

```bash
# Install dependencies
bun install

# Run locally
bun dev

# Build for distribution
bun run build
```

## License

MIT
