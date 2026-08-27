"use client";

import {
  ArrowRight,
  CalendarDays,
  Clapperboard,
  LayoutGrid,
  Plus,
  Sparkles,
  Store,
} from "lucide-react";
import Link from "next/link";

const projects = [
  {
    title: "The First Bite",
    type: "Product promo",
    status: "Ready for filming",
    emoji: "🍔",
  },
  {
    title: "Friday Night",
    type: "Event campaign",
    status: "Draft",
    emoji: "🎧",
  },
];

export default function Home() {
  return (
    <main className="app">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logoMark">A</div>
          <span>
            ATLAS <b>SCENE</b>
          </span>
        </div>

        <nav className="nav">
          <Link href="/" className="navItem active">
            <LayoutGrid size={18} />
            Overview
          </Link>

          <Link href="/create" className="navItem">
            <Sparkles size={18} />
            Create
          </Link>

          <Link href="#" className="navItem">
            <Clapperboard size={18} />
            Projects
          </Link>

          <Link href="#" className="navItem">
            <CalendarDays size={18} />
            Content calendar
          </Link>

          <Link href="#" className="navItem">
            <Store size={18} />
            Business
          </Link>
        </nav>

        <div className="business">
          <div className="businessAvatar">BH</div>

          <div>
            <strong>Burger House</strong>
            <span>Restaurant</span>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <section className="main">
        <header className="header">
          <div>
            <span className="eyebrow">MONDAY · AUGUST 10</span>

            <h1>Good afternoon, Burger House.</h1>
          </div>

          <div className="online">
            <span />
            AI Director online
          </div>
        </header>

        {/* HERO */}
        <section className="hero">
          <div className="heroText">
            <span className="eyebrow">CREATE CONTENT</span>

            <h2>What are we creating today?</h2>

            <p>
              Tell Scene what you want to promote. It already knows your
              business.
            </p>

            <Link href="/create" className="primaryButton">
              <Sparkles size={17} />
              Create something
              <ArrowRight size={17} />
            </Link>
          </div>

          <div className="heroVisual">
            <div className="orbit orbitOne" />
            <div className="orbit orbitTwo" />

            <div className="heroCore">
              <Sparkles size={28} />
            </div>
          </div>
        </section>

        {/* QUICK ACTIONS */}
        <section className="quickActions">
          {[
            ["🍔", "Product promo"],
            ["🔥", "Offer"],
            ["🎉", "Event"],
            ["📱", "Social reel"],
          ].map(([icon, label]) => (
            <Link href="/create" className="quickCard" key={label}>
              <span>
                {icon} {label}
              </span>

              <ArrowRight size={16} />
            </Link>
          ))}
        </section>

        {/* PROJECTS */}
        <section className="section">
          <div className="sectionHeader">
            <div>
              <span className="eyebrow">YOUR WORK</span>
              <h3>Recent projects</h3>
            </div>

            <Link href="/create" className="newProject">
              New project
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="projects">
            {projects.map((project) => (
              <div className="project" key={project.title}>
                <div className="projectPreview">
                  <span>{project.emoji}</span>
                </div>

                <div className="projectInfo">
                  <small>{project.type}</small>

                  <h4>{project.title}</h4>

                  <div className="projectBottom">
                    <span className="status">{project.status}</span>

                    <span>Today</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* OPPORTUNITY */}
        <section className="opportunity">
          <div className="opportunityIcon">
            <Sparkles size={18} />
          </div>

          <div>
            <span className="eyebrow">CONTENT OPPORTUNITY</span>

            <h3>You have a live DJ event this Friday.</h3>

            <p>
              There is no promotional content yet. Scene can build the campaign
              for you.
            </p>
          </div>

          <Link href="/create" className="secondaryButton">
            Build campaign
            <ArrowRight size={16} />
          </Link>
        </section>
      </section>
    </main>
  );
}