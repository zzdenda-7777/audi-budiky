package cz.audibudiky

import org.junit.Test

/** Runs every OBD scenario against the simulated ELM327 adapter (see FakeElm, ObdScenarios). */
class ObdSimTest {
    @Test
    fun obdScenarios() {
        val fails = ArrayList<String>()
        for ((name, run) in ObdScenarios.ALL) {
            try { println("OK OBD $name — ${run()}") }
            catch (e: Throwable) { println("FAIL OBD $name — ${e.message}"); fails.add(name) }
        }
        println("TESTY OBD: ${ObdScenarios.ALL.size - fails.size}/${ObdScenarios.ALL.size} prošlo")
        if (fails.isNotEmpty()) throw AssertionError("Selhalo: " + fails.joinToString())
    }
}
