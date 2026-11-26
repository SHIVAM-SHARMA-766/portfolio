// Admin entry point.
import { render } from 'preact';
import { App } from './shell.jsx';
import './style.css';

render(<App />, document.getElementById('app'));
