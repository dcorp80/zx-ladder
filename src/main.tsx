import { render } from "solid-js/web";
import { bootApp } from "./boot";
import "./styles.css";

const booted = await bootApp();
const root = document.getElementById("root");
if (!root) throw new Error("#root not found");
render(booted.ui, root);
