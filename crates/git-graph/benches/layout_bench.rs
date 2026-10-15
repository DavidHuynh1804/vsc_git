use git_graph::{layout, CommitNode, RefKind, RefLabel};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use std::time::Instant;

fn generate_synthetic_commits(count: usize) -> Vec<CommitNode> {
    let mut rng = StdRng::seed_from_u64(42);
    let mut commits = Vec::with_capacity(count);

    // Generate topological order: commits[0] is newest, commits[count-1] is oldest (root)
    for i in 0..count {
        let sha = format!("sha_{:08x}", i);
        let parents = if i == count - 1 {
            // Initial root commit has no parents
            Vec::new()
        } else {
            let p0 = format!("sha_{:08x}", i + 1);
            let roll: f64 = rng.gen();
            if roll < 0.15 && i + 2 < count {
                // 15% merge commit: 2 parents
                let max_offset = 15.min(count - i);
                let p1_offset = rng.gen_range(2..=max_offset.max(2));
                let p1 = format!("sha_{:08x}", (i + p1_offset).min(count - 1));
                vec![p0, p1]
            } else if roll < 0.17 && i + 3 < count {
                // 2% octopus merge: 3 parents
                let p1 = format!("sha_{:08x}", i + 2);
                let p2 = format!("sha_{:08x}", i + 3);
                vec![p0, p1, p2]
            } else {
                // 83% linear commit: 1 parent
                vec![p0]
            }
        };

        let refs = if i % 100 == 0 {
            vec![RefLabel::new(
                format!("branch_{}", i / 100),
                RefKind::LocalBranch,
            )]
        } else {
            Vec::new()
        };

        commits.push(CommitNode::new(sha, parents, refs));
    }

    commits
}

fn main() {
    println!("Generating 200,000 synthetic commits with fixed seed (42)...");
    let gen_start = Instant::now();
    let commits = generate_synthetic_commits(200_000);
    println!("Generated in {:.2?}", gen_start.elapsed());

    // Warm-up run with smaller slice
    println!("Warming up...");
    let _ = layout(&commits[..10_000]);

    println!("Running benchmark on 200,000 commits...");
    let start = Instant::now();
    let rows = layout(&commits);
    let duration = start.elapsed();

    let ms = duration.as_secs_f64() * 1000.0;
    println!("============================================================");
    println!("Layout result for 200,000 commits: {} rows", rows.len());
    println!("Elapsed time: {:.2} ms ({:.2?})", ms, duration);
    println!("Performance threshold: < 300 ms");
    println!("============================================================");

    assert!(
        duration.as_millis() < 300,
        "Benchmark failed: layout took {}ms (limit: 300ms)",
        duration.as_millis()
    );
    println!("Benchmark PASSED!");
}
