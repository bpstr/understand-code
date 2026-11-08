#!/usr/bin/env node
import { main } from '../lib/understand_code/cli.js';

process.exitCode = main(process.argv.slice(2));
