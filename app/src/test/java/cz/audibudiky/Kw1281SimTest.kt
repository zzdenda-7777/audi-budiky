package cz.audibudiky

import org.junit.Test

/** Runs every protocol scenario against the simulated car (see FakeCar, KwScenarios). */
class Kw1281SimTest {
    @Test
    fun protocolScenarios() {
        val fails = ArrayList<String>()
        for ((name, run) in KwScenarios.ALL) {
            try { println("OK $name — ${run()}") }
            catch (e: Throwable) { println("FAIL $name — ${e.message}"); fails.add(name) }
        }
        println("TESTY: ${KwScenarios.ALL.size - fails.size}/${KwScenarios.ALL.size} prošlo")
        if (fails.isNotEmpty()) throw AssertionError("Selhalo: " + fails.joinToString())
    }
}
